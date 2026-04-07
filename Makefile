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

## help: Display this help
.PHONY: help
help:
	@echo "Usage:"
	@sed -n 's/^##//p' ${MAKEFILE_LIST} | column -t -s ':' | sed -e 's/^/ /'
