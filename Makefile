.PHONY: build test fmt deploy setup-js test-js
build:
	cd contracts && stellar contract build
test: build
	cd contracts && cargo test
fmt:
	cd contracts && cargo fmt --all
deploy:
	scripts/deploy.sh
setup-js:
	npm --prefix sdk ci
	npm --prefix sdk run build
	npm --prefix dashboard ci
test-js:
	npm --prefix sdk run build
	npm --prefix sdk test
	npm --prefix dashboard ci --ignore-scripts
	npm --prefix dashboard test
	npm --prefix dashboard run build
