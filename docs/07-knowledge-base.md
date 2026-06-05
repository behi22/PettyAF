# PettyAF Org Provisioning Record (staging)

## Persona agents (created 2026-06-05, placeholder prompts for now)

```
PERSONA_AGENT_MAP={"child":"7f4c7c88-848a-4917-b874-c9f53c578be2","medieval":"ea0e68c7-eca5-4b39-939b-7ee33b736c0d","angry":"ae15fe74-3856-4a67-a665-f62eabb78158"}
```

| Key | Staging agent name | Agent id | Prompt status |
|---|---|---|---|
| `child` | Kid | `7f4c7c88-848a-4917-b874-c9f53c578be2` | placeholder, paste docs/prompts/child.md |
| `medieval` | Medival | `ea0e68c7-eca5-4b39-939b-7ee33b736c0d` | placeholder, paste docs/prompts/medieval.md |
| `angry` | Angry | `ae15fe74-3856-4a67-a665-f62eabb78158` | placeholder, paste docs/prompts/angry.md |

Engine key: mint on `dev.voice.alebex.ai/docs/keys` (+ New Key, name `pettyaf`). Goes to `.env` only, never this repo.

---

# Knowledge Base

> Status: CREATED on staging 2026-06-05, placeholder content. Created early because
> `POST /campaigns` requires `knowledgeBaseId` NOT NULL (backend plan 06, section 3.1,
> verify-first A). Real content (the Collections Manual from main.md section 5) gets PUT
> over it later.

## The ID Manav needs

```
STAGING_KNOWLEDGE_BASE_ID=7436c195-d30e-4177-9461-85df8dcaddf4
```

## What exists on staging

| Field | Value |
|---|---|
| id | `7436c195-d30e-4177-9461-85df8dcaddf4` |
| Name | PettyAF Collections Manual |
| Content | one-line placeholder (see below) |
| isDefault | true |
| isActive | true |
| Org | PettyAF (`d5078339-f3b0-4cbb-a0bb-2e4e9df75f1d`) |

## Two live API discoveries (corrections to plan 06, section 6.1)

1. **Login returns `data.token`, NOT `data.accessToken`.** Verified live: the envelope is
   `{ success, data: { user, token, refreshToken, expiresIn, requirePasswordChange } }`.
   Update the staging client accordingly.
2. **`POST /knowledge-base` returns the RAW entity, no `{success, data}` envelope.** The
   per-endpoint-parse warning in plan 06 is real: do not assume one response shape.

Placeholder content as created:

```
PettyAF Collections Inc. knowledge base. Placeholder. The full Collections Manual
(settlement protocol, what collectors may accept, what not to say) lands here before
the demo. See main.md section 5 for the real content.
```

## How it was created (repeatable)

```bash
# 1. login (org-admin), grab data.accessToken from the response envelope
curl -s -X POST https://api-staging.alebex.ai/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<org-admin email>","password":"<password>"}'

# 2. create the KB, grab the id from the response
curl -s -X POST https://api-staging.alebex.ai/api/v1/knowledge-base \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"name":"PettyAF Collections Manual","content":"PettyAF Collections Inc. knowledge base. Placeholder. The full Collections Manual (settlement protocol, what collectors may accept, what not to say) lands here before the demo. See main.md section 5 for the real content.","isDefault":true}'
```

## Updating it later (the "fix it later" step)

```bash
curl -s -X PUT https://api-staging.alebex.ai/api/v1/knowledge-base/<id> \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"content":"<full Collections Manual from main.md section 5>"}'
```

Endpoints verified against the platform reference code: `knowledge-base.controller.ts`
(`POST /knowledge-base` line 188, `PUT /knowledge-base/:id` line 205, `GET /knowledge-base`
line 39, all behind JWT). List shape: `GET /knowledge-base` returns the org's KBs; use it to
re-find the id if this doc falls out of date.
