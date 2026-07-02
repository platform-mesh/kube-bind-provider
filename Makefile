# Copyright 2026 The Platform Mesh Authors.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

SHELL := /usr/bin/env bash

# Go parameters
GOCMD = go
GOBUILD = $(GOCMD) build
GORUN = $(GOCMD) run
GOMOD = $(GOCMD) mod
GOFMT = $(GOCMD) fmt

# Binary names
INIT_BINARY_NAME = init

# Build directory
BUILD_DIR = bin

# Image parameters
IMAGE_REGISTRY ?= ghcr.io/platform-mesh
IMAGE_TAG ?= dev

# Init image
INIT_IMAGE_NAME ?= kube-bind-provider-init
INIT_IMAGE ?= $(IMAGE_REGISTRY)/$(INIT_IMAGE_NAME):$(IMAGE_TAG)

# Portal image
PORTAL_IMAGE_NAME ?= kube-bind-provider-portal
PORTAL_IMAGE ?= $(IMAGE_REGISTRY)/$(PORTAL_IMAGE_NAME):$(IMAGE_TAG)
PORTAL_PORT ?= 4300

.PHONY: all
all: build

## build: Build all binaries
.PHONY: build
build: build-init

## build-init: Build the init/bootstrap binary
.PHONY: build-init
build-init: fmt vet
	$(GOBUILD) -o $(BUILD_DIR)/$(INIT_BINARY_NAME) ./cmd/init/...

## fmt: Run go fmt
.PHONY: fmt
fmt:
	$(GOFMT) ./...

## vet: Run go vet
.PHONY: vet
vet:
	$(GOCMD) vet ./...

## tidy: Run go mod tidy
.PHONY: tidy
tidy:
	$(GOMOD) tidy

## init-image-build: Build init container image locally
.PHONY: init-image-build
init-image-build:
	docker build -t $(INIT_IMAGE) -f deploy/Dockerfile .

## init-image-push: Push init container image to registry
.PHONY: init-image-push
init-image-push: init-image-build
	docker push $(INIT_IMAGE)

## portal-image-build: Build portal container image locally
.PHONY: portal-image-build
portal-image-build:
	docker build -t $(PORTAL_IMAGE) -f deploy/portal.Dockerfile .

## portal-image-push: Push portal container image to registry
.PHONY: portal-image-push
portal-image-push: portal-image-build
	docker push $(PORTAL_IMAGE)

## images: Build all container images
.PHONY: images
images: init-image-build portal-image-build

## images-push: Push all container images
.PHONY: images-push
images-push: init-image-push portal-image-push

# Kind cluster parameters
KIND_CLUSTER ?= platform-mesh

## kind-load-init: Load init image into kind cluster
.PHONY: kind-load-init
kind-load-init:
	kind load docker-image $(INIT_IMAGE) --name $(KIND_CLUSTER)

## kind-load-portal: Load portal image into kind cluster
.PHONY: kind-load-portal
kind-load-portal:
	kind load docker-image $(PORTAL_IMAGE) --name $(KIND_CLUSTER)

## kind-load-all: Load all images into kind cluster
.PHONY: kind-load-all
kind-load-all: kind-load-init kind-load-portal

## portal-run: Run portal container locally (accessible at http://localhost:$(PORTAL_PORT))
.PHONY: portal-run
portal-run:
	docker run --rm -p $(PORTAL_PORT):8080 $(PORTAL_IMAGE)

## portal-run-detached: Run portal container in background
.PHONY: portal-run-detached
portal-run-detached:
	docker run -d --rm --name kube-bind-portal -p $(PORTAL_PORT):8080 $(PORTAL_IMAGE)
	@echo "Portal running at http://localhost:$(PORTAL_PORT)"
	@echo "Stop with: docker stop kube-bind-portal"

## portal-stop: Stop the portal container
.PHONY: portal-stop
portal-stop:
	docker stop kube-bind-portal

## helm-deps: Update Helm chart dependencies
.PHONY: helm-deps
helm-deps:
	helm dependency update deploy/helm/kube-bind-portal

# OCM / Helm publishing parameters
OCM ?= ocm
HELM ?= helm
OCM_REPO ?= ghcr.io/platform-mesh
OCM_CTF ?= .ocm/transport.ctf
# Component name (must match constructor/component-constructor.yaml).
OCM_COMPONENT ?= github.com/platform-mesh/kube-bind-provider
# Charts are published under this repo's own GHCR namespace (self-contained, alongside
# the container images) rather than the shared helm-charts registry.
HELM_REPO ?= ghcr.io/platform-mesh/kube-bind-provider/charts
VERSION ?= 0.0.0-dev
CHART_VERSION ?= $(VERSION)
IMAGE_VERSION ?= $(VERSION)
# OCI registry tag for the referenced local images (free-form, e.g. "latest" or "0.1.0").
# Defaults to "latest" so local builds resolve against an existing tag; CI sets the release tag.
OCI_TAG ?= latest
# Upstream kube-bind artifacts bundled (by reference) into our OCM component and relocated
# into $(OCM_REPO) on `ocm-push`. Keep in sync with each other and with the backend image
# tag in config/platfrom-mesh-ocm/managedprovider.yaml.
BACKEND_CHART_VERSION ?= 0.0.0-9aa7dc83de93180718abbb7e548161a003b8999a
BACKEND_IMAGE_TAG ?= 0.0.0-6ac88b0f68dc5247c773dd6c3b3a0f44a64e9b1b
# Charts this repo owns. The OCM component embeds them (input: helm) and publishes them as
# OCI artifacts on `ocm-push`; `helm-push` is the standalone (non-OCM) publish path.
HELM_CHARTS ?= kube-bind-portal

## ocm-build: Build OCM component archive (CTF) from constructor/component-constructor.yaml
# NOTE: the component references our portal chart as a published OCI artifact, so run
# `make helm-push` first (or use `make ocm-release`, which chains them) — otherwise OCM
# cannot resolve the portal chart's digest here.
.PHONY: ocm-build
ocm-build:
	mkdir -p $(dir $(OCM_CTF))
	rm -rf $(OCM_CTF)
	$(OCM) add components -c --templater=go --file $(OCM_CTF) constructor/component-constructor.yaml -- \
	  VERSION=$(VERSION) \
	  CHART_VERSION=$(CHART_VERSION) \
	  IMAGE_VERSION=$(IMAGE_VERSION) \
	  OCI_TAG=$(OCI_TAG) \
	  BACKEND_CHART_VERSION=$(BACKEND_CHART_VERSION) \
	  BACKEND_IMAGE_TAG=$(BACKEND_IMAGE_TAG)

## ocm-push: Transfer the OCM component to $(OCM_REPO), relocating ALL resources by-value
# --copy-resources / --copy-local-resources pull the referenced external artifacts (upstream
# backend chart + image) and this repo's images into $(OCM_REPO), and publish the embedded
# charts as OCI artifacts there — making the component fully self-contained.
.PHONY: ocm-push
ocm-push: ocm-build
	$(OCM) transfer ctf --overwrite --copy-resources --copy-local-resources $(OCM_CTF) $(OCM_REPO)

## ocm-release: Full release path — push images, publish the portal chart, then build + push the OCM component
# Prerequisites run in order: images-push → helm-push (portal chart as OCI) → ocm-push.
.PHONY: ocm-release
ocm-release: images-push helm-push ocm-push

## ocm-describe: Print the locally built component descriptor
.PHONY: ocm-describe
ocm-describe: ocm-build
	$(OCM) get componentversions --repo $(OCM_CTF) -o yaml

## ocm-inspect: List the resources of the locally built OCM component (name/type/relation/access)
.PHONY: ocm-inspect
ocm-inspect: ocm-build
	$(OCM) get resources --repo $(OCM_CTF) $(OCM_COMPONENT):$(VERSION) -o wide

## helm-push: Package and push deployable Helm charts to $(HELM_REPO) as OCI artifacts
.PHONY: helm-push
helm-push:
	mkdir -p $(BUILD_DIR)/charts
	@for chart in $(HELM_CHARTS); do \
	  echo "==> packaging $$chart $(CHART_VERSION)"; \
	  $(HELM) dependency build deploy/helm/$$chart || exit 1; \
	  $(HELM) package deploy/helm/$$chart \
	    --version $(CHART_VERSION) \
	    --app-version $(IMAGE_VERSION) \
	    --destination $(BUILD_DIR)/charts || exit 1; \
	  echo "==> pushing $$chart-$(CHART_VERSION).tgz to oci://$(HELM_REPO)"; \
	  $(HELM) push $(BUILD_DIR)/charts/$$chart-$(CHART_VERSION).tgz oci://$(HELM_REPO) || exit 1; \
	done

## help: Display this help
.PHONY: help
help:
	@echo "Usage:"
	@sed -n 's/^##//p' ${MAKEFILE_LIST} | column -t -s ':' | sed -e 's/^/ /'
