# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 1.x | Yes |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report them privately via GitHub's [Security Advisories](https://github.com/mietek64/opendoku/security/advisories/new) page, or email the maintainer directly.

Expect an acknowledgement within 72 hours and a resolution or update within 14 days.

## Note on Pre-built Executables

The `.exe` released on this page is built with PyInstaller directly from the source in this repository. If you have concerns about the binary, you can verify it by building from source yourself — see [Build from Source](README.md#build-from-source) in the README.

Windows Defender and other antivirus tools sometimes flag PyInstaller-packaged executables as suspicious. This is a known false positive caused by PyInstaller's bootloader. The full source is available here for inspection.
