---
id: ar-mpbi
status: open
deps: [ar-g1z6]
links: []
created: 2026-07-10T21:28:57Z
type: task
priority: 2
assignee: David Torres
tags: [frontend, testing]
---
# Add automated coverage for critical browser workflows

The largest modules are public browser scripts, especially character wizard and general app behavior, with no automated browser coverage.

## Acceptance Criteria

Pure client state logic is extracted and unit-tested where practical; a browser smoke suite covers character create/edit and wizard submission; suite runs in CI.

