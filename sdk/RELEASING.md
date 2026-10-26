# Publishing the SDK

The package name is currently `@kovan-protocol/sdk`. Publishing requires an npm account
with access to that user or organization scope. GitHub organization ownership
does not grant npm scope ownership.

## Prepare

From `sdk/`, using Node.js 22 or newer:

```bash
npm ci
npm test
npm run test:browser
npm run test:package
```

The browser check requires Chromium (`CHROMIUM_PATH` can select its executable).
The package check installs the tarball into a temporary consumer and verifies
both the public imports and TypeScript declarations. These checks do not send
transactions.

Keep `package.json` and `package-lock.json` versions in sync. A published
name/version cannot be reused for a different artifact.

## Authenticate and publish

```bash
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm view @kovan-protocol/sdk versions --json --registry=https://registry.npmjs.org/
```

A registry 404 is expected before the first public release; it does not confirm
scope ownership. Complete npm's account and publishing verification in the
browser or terminal. Never commit an npm token.

For interactive publishing, enable two-factor authentication in the npm
account's settings first. A successful `npm login` alone is not sufficient:
npm rejects publishing from an account without the required 2FA. See the
[npm 2FA setup guide](https://docs.npmjs.com/configuring-two-factor-authentication/).

Pack into an empty directory outside the repository, inspect its file list, and
publish that exact tarball. Replace the path and version below with the artifact
being released:

```bash
npm pack --json --pack-destination /tmp/kovan-npm-release
tar -tzf /tmp/kovan-npm-release/kovan-protocol-sdk-0.2.0.tgz
npm publish /tmp/kovan-npm-release/kovan-protocol-sdk-0.2.0.tgz --access public --registry=https://registry.npmjs.org/
npm view @kovan-protocol/sdk@0.2.0 version dist.integrity --json --registry=https://registry.npmjs.org/
```

Create the output directory first. Review the compiled files, sources, examples,
README and license; no secrets, wallet keys or local configuration belong in the
tarball. Publishing a tarball does not run the working directory's release
checks, so run them before packing.

npm scans uploads before they become installable. A successful publish can
temporarily be followed by a registry 404; wait and retry `npm view` instead of
republishing the same version. Processing usually takes several minutes and
can take longer. See [npm's publish-time scanning announcement](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/).

After registry verification, install that published version into a fresh
consumer, then update the local-package status in `docs/SDK.md` and the website's
SDK and quickstart pages. Do not describe the release as published until the
registry confirms it.
