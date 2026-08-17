# Compatibility policy

| Component | Tested version | Policy |
| --- | --- | --- |
| Node.js | 24.14.1 (minimum 22.19) | CI runs on Node 22; local acceptance used Node 24 |
| Pi packages | 0.84.2 | Pi adapter peers are constrained to `>=0.84.2 <0.85.0-0` |
| DeepSeek Harness CLI | `@deepseek-ai/dsh@0.1.0-rc.6` | Adapter peers are constrained to the 0.1 preview line |
| DeepSeek Harness commit | `47f943859bef60e4160492346772ded9b24f765a0` | Later commits require a fresh acceptance run |
| Pi Context Desktop | 0.1.4 | Windows x64 community build in the separate fork |

Host compatibility is not inferred from package installation alone. A release
must pass unit fixtures, a clean profile install, restart persistence checks,
and a session-log hash comparison.
