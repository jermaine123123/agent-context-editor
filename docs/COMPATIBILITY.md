# Compatibility policy

| Component | Tested version | Policy |
| --- | --- | --- |
| Node.js | 24.14.1 (minimum 22.19) | CI runs on Node 22; local acceptance used Node 24 |
| Pi packages | 0.84.2 | Pi adapter peers are constrained to `>=0.84.2 <0.85.0-0` |
| DeepSeek Harness CLI | `@deepseek-ai/dsh@0.1.0-rc.8` | Adapter peers are constrained to the tested rc.8 preview line |
| DeepSeek Harness commit | `141eb6fef83422698aef7a981029e843e8161534` | Later commits require a fresh acceptance run |
| Pi Context Desktop | 0.1.4 | Windows x64 community build in the separate fork |

Host compatibility is not inferred from package installation alone. A release
must pass unit fixtures, a clean profile install, restart persistence checks,
and a provider payload capture. The acceptance invariant is that original
Surface nodes, historical messages and the main chat timeline stay unchanged;
the allowed mutation is an appended adapter-owned `context/projection` event.
DeepSeek replacement is enabled for eligible User/Answer units in the tested
rc.8 boundary; this local release did not include an external DeepSeek API request.
