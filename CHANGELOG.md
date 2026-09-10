# Changelog

## 0.2.0 - 2026-09-10

### Added

- Windows NSIS installer and portable executable targets.
- Tag-driven GitHub Release workflow with SHA-256 checksums.
- Continuous integration for unit, build, and renderer E2E checks.
- In-place Save command and Ctrl+S shortcut.
- Automatic recovery prompt when a newer autosave is available.
- Backup fallback under the application user-data directory.
- Renderer crash recovery dialog and single-instance behavior.

### Changed

- Backup writes now use a flushed temporary file and rename sequence.
- Backup retention is limited to 20 autosaves and 10 source backups per document.
- Packaged renderer URLs use `pathToFileURL`.
- Production builds no longer expose Reload or DevTools menu items.
- Minimum window size now permits the existing compact layout.
- Save As asset discovery handles data URL srcsets and non-file URI schemes.

### Fixed

- Potential Save As failures for HTML containing `mailto:`, `tel:`, `javascript:`, or data URL srcset references.
- Missing clean-clone packaging input caused by the ignored `HTML_reference` directory.
- Preview messages from frames other than the active report preview being accepted.
