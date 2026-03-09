# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-03-09

### Added
- Support for global type augmentation of `SessionData`. Users can now define their session structure once via `declare module 'relay-session'` instead of passing generics to every middleware or helper call.

## [1.1.0] - 2026-03-09

### Added

- `Session.data` now has a `set` accessor — the entire data object can be replaced via `session.data = { ... }`. Assigning `null` or `undefined` falls back to an empty object `{}`
- Generic type parameter `T` is now constrained to `Record<string, unknown>` across `Session`, `sessionMiddleware` and `createSession`, preventing scalar values from being used as session data

## [1.0.3] - 2026-03-09

### Fixed

- New sessions are no longer passed to `store.merge()` — the merge path is now skipped when `isNew` is true, preventing the Lua script from receiving `nil` and failing to persist the session

## [1.0.2] - 2026-03-09

### Fixed

- Session rotation now writes directly to the store, bypassing the dirty-check in `save()` to ensure the full rotated session is always persisted

## [1.0.1] - 2026-03-09

### Fixed

- Prevent crash when request closes before session is initialized (`req.session` accessed with optional chaining)

## [1.0.0] - 2026-03-09

### Added

- Initial release
