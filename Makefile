.PHONY: build test fmt deploy
build:
	cd contracts && stellar contract build
test: build
	cd contracts && cargo test
fmt:
	cd contracts && cargo fmt --all
deploy:
	scripts/deploy.sh
