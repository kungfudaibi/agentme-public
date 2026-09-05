# ADR 0004: QQ Bot is the first Tencent channel

Status: accepted

Use the official Tencent QQ Bot API as the first remote adapter, behind the common channel boundary. Default to owner-paired private conversations; groups and unknown senders may chat but cannot invoke coding or filesystem capabilities. Keep Enterprise Weixin as the official fallback. Do not integrate unofficial personal-Weixin protocols.
