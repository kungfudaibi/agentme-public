# Security

Do not put API keys, authentication tokens, recordings, personal records or
unredacted runtime logs in issues, pull requests or commits. Use synthetic data
when reporting bugs. If credentials are exposed, revoke them at their provider;
deleting a file or commit alone does not make them safe again.

Use GitHub private vulnerability reporting for security reports when available.
Include affected versions and a minimal reproduction without live credentials.

AgentMe is a local application with powerful optional coding tools. Register only
repositories you intend it to access. Keep the default worktree restrictions and
review changes before merging. A configured backend still needs its own valid
installation and credentials.

The office's ordinary task and conversation data is stored locally as plaintext.
The personal dashboard uses protected storage. See the operations documentation
for their distinct retention and deletion behavior.
