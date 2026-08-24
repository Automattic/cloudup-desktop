.PHONY: help install build dev stage prod start test lint fix mutation mutation-incremental dist dist\:mac hooks

help: ## Show available targets
	@grep -E '^[a-zA-Z_\\:-]+:.*?## .*$$' $(MAKEFILE_LIST) | sed 's/\\//' | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-24s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies (if lockfile changed)
	@if [ node_modules/.package-lock.json -ot package-lock.json ] || [ ! -d node_modules ]; then \
		npm install; \
	fi

build: install ## Compile TypeScript
	npm run build

dev: install ## Build and run against cloudup.test (requires the cloudup-mono dev stack)
	npm run dev

stage: install ## Build and run against staging
	npm run stage

prod: install ## Build and run against production
	npm run prod

start: install ## Run without rebuilding
	npm run start

test: install ## Run Jest tests
	npm test

lint: install ## Lint
	npm run lint

fix: install ## Auto-fix lint
	npm run lint:fix

mutation: install ## Full Stryker mutation run + follow-up report
	npm run test:mutation; npm run mutation:follow-up

mutation-incremental: install ## Incremental Stryker mutation run + follow-up report
	npm run test:mutation:incremental; npm run mutation:follow-up

dist: install ## Package for distribution
	npm run dist

dist\:mac: install ## Package macOS DMG
	npm run dist:mac

hooks: ## Install git hooks
	cp git/pre-push .git/hooks/pre-push && chmod +x .git/hooks/pre-push
