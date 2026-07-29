# START HERE — read this one first

Plain-language guide. No jargon. If a word is technical, it is explained right there
the first time it appears.

---

## 0. Quick glossary — read this once, skip it later

These words appear everywhere in this project. If you already know them, skip to §1.

| Word | What it means in plain language |
|---|---|
| **Threads API** | Meta's "door" that lets programs post to Threads. You get a key (token) that proves the program is allowed to act as you. |
| **Token** | A long random-looking password string. You get it from Meta, paste it into the system, and the system uses it to prove "yes, the real human gave me permission to post." |
| **n8n** | A free program that runs "workflows" — chains of steps like "at 8am, check the database, write a post, send it to Threads." It has a web interface you open in your browser. Think of it as a visual recipe book for automation. |
| **Docker** | A way to run programs in isolated boxes called "containers." Each container has its own little filesystem and memory limit. You type `docker compose up -d` and all the containers start at once. You never need to understand how it works internally. |
| **Cloudflare Tunnel** | A secure pipe from your VPS to Cloudflare's network. It lets people reach your server without you opening any ports on your firewall. Also gives you free HTTPS. |
| **PostgreSQL** (or "Postgres") | A database — a place where the system stores products, posts, clicks, and scores. It runs inside Docker. You talk to it by typing `psql` commands. |
| **9router** | A small program that sits between the system and the AI companies (OpenAI, Google, Anthropic). Instead of the system talking directly to 3 different AI services, it talks to 9router, and 9router forwards the request to whichever AI model is cheapest or best for the job. It runs on your VPS alongside everything else. |
| **LLM** | "Large Language Model" — the AI that writes the posts. When this doc says "the LLM writes a post," it means the system sends a prompt to an AI like GPT or Gemini and gets text back. |
| **Cloudflare R2** | Cloudflare's version of cloud file storage. You upload images here and they get a public URL anyone can open. Free for the amount you will use. |
| **SigV4** | A way to prove to R2 that you are allowed to upload files. The code handles it automatically. You just paste in two strings (a key and a secret) from the Cloudflare dashboard. |

---

## 1. What this thing actually does

You give it: **a Shopee affiliate link**, optionally the normal full product URL for enrichment, plus **photos or a written description** (either is fine).

It then does this forever, by itself:

- Writes 5 posts a day in Malay, each one in a different style
- Puts them on Threads at slightly random times (so it does not look like a robot)
- Puts your affiliate link in the **first comment**, not in the post
- Counts who clicks and who buys
- **Every 3 days it checks which styles made money, and does more of those**

That last point is the whole idea. It is not a posting robot. It is a robot that *learns what
sells* and keeps getting better while you sleep.

**Why the link goes in the comment:** Threads shows your post to fewer people if there is an
outside link in it. Link in the comment = post stays clean = more people see it.

---

## 2. Everything is in Malay, for Malaysia

Set up for Malaysia, not Indonesia:

- Copy is written in everyday Malaysian Malay — *tak, nak, dah, je, lah* — and mixing in English
  words (rojak) is allowed, because that is how Malaysians actually post
- Prices in **RM**
- Times in **Kuala Lumpur** time
- Links point to **shopee.com.my**

**The system actively blocks Indonesian.** This matters more than it sounds. Two Indonesian words
are dangerous in Malay:

| Indonesian word | Means in Indonesia | Means in Malaysia |
|---|---|---|
| `bisa` | can / able to | **venom, poison** |
| `butuh` | need | **vulgar slang** |

If the AI slipped and wrote *"produk ini bisa dipakai"*, a Malaysian reads *"this product is
poison"*. So there is an automatic filter that rejects any post containing Indonesian words
(*banget, nggak, gak, aja, udah, bikin, gimana, kalian*) before it ever gets posted. Tested and
confirmed working.

---

## 3. Three ways to add a product

| What you give it | Works? | What you get |
|---|---|---|
| Link + photos | Yes | Posts with photos |
| Link + photos + description | Yes | Best results |
| **Link + description only** | Yes | **Text-only posts. No photos needed at all.** |
| Link by itself | No | Rejected — see below |

**Why link-only is rejected:** with no photo and no words, the AI has nothing real to write about,
so it would invent things. Made-up details are exactly what makes affiliate posts look fake. If
you have no photos, just write 2–3 real sentences about the product (size, price, how long you
have used it) and that is enough.

**Text-only posts are not second-best.** Threads is mostly a text app, and text posts often reach
*more* people than photo posts. The system tries both and tells you which works better for your
account. Even for products where you uploaded photos, about 15% of posts will be text-only, just
to check.

---

## 4. Before you start — what you need

You need these things ready. If you do not have them yet, the runbook in §5 tells you how to
get each one.

| Thing | What it is | Where to get it |
|---|---|---|
| A VPS (virtual server) | A computer in the cloud that runs 24/7. 4GB RAM, 2 CPUs, Debian or Ubuntu. Costs ~$5–10/month. | DigitalOcean, Linode, Hetzner, Vultr |
| A domain name | `yourdomain.com`. You need it for Cloudflare Tunnel to work. | Namecheap, Cloudflare Registrar, Porkbun (~$10/year) |
| A Cloudflare account | Free. Your domain must use Cloudflare's DNS (nameservers). | cloudflare.com |
| A Meta developer account | Also free. This is where you get the Threads posting token. | developers.facebook.com |
| A Threads account | Your own. The system posts to it. | threads.net |
| Docker installed on the VPS | Lets you run the system's containers. | One command: `curl -fsSL https://get.docker.com | sh` |
| An API key for an AI provider | Lets the system call GPT or Gemini to write posts. Costs ~$0.30/month at 5 posts/day. | OpenAI, Google AI Studio, or Anthropic |

> **If you do not have a VPS or domain yet:** do not panic. The runbook (Step 2) is pure
> copy-paste commands. You can rent a VPS in 5 minutes and copy-paste one line to install
> Docker. The domain + Cloudflare setup takes about 15 minutes.

---

## 5. What you have to do yourself

The system cannot do these. Budget about a day, most of it waiting.

### Step 1 — Get permission from Meta (~2 hours, mostly waiting)

You need a **token** (a long password string) that lets the system post to your Threads account.

1. Go to developers.facebook.com → Create App → choose "Access the Threads API"
2. Tick these permissions: `threads_basic`, `threads_content_publish`,
   `threads_manage_insights`, `threads_manage_replies`
3. **Important shortcut:** in App roles → Threads Tester → add your own username. Then accept
   the invite in the Threads app (Settings → Website permissions).
   This lets you skip Meta's review process completely, which otherwise takes weeks.
4. Test it works by posting one message with the copy-paste command in
   `docs/03-setup-runbook.md`. **Do not build anything else until you see that test post appear.**

### Step 2 — Put the system online (~1 hour)

Follow `docs/03-setup-runbook.md`. It is copy-paste commands with explanations of what each one
does and why.

The one part people get wrong: you need 4 web addresses pointing at your server, and **two of
them must be public**:

| Address | Who needs to reach it | Locked? | Why |
|---|---|---|---|
| `n8n.yourdomain.com` | just you | Lock it | Your automation dashboard. If strangers see this, they can control your posts. |
| `kb.yourdomain.com` | just you | Lock it | Where you add products and upload PDFs. |
| `r.yourdomain.com` | **your buyers** | Must be open | The short link in your post comments. Buyers click this to reach Shopee. |
| `cdn.yourdomain.com` | **Meta's servers** | Must be open | Meta fetches your product photos from here before publishing your post. |

If you lock the last two (`r.` and `cdn.`), buyers cannot click your links and photos will not
upload. This is the number one reason setups silently do not work.

### Step 3 — Copy-paste 7 code snippets (~15 minutes)

Two of the four automations come as templates with blank spots. You open each blank spot and
paste in a file from the `n8n/code/` folder. The runbook tells you exactly which file goes where.

(Why is this not done already? The code is about 600 lines. Putting it inside the template would
make it impossible to read or fix. Keeping it as separate files means you can actually see and
change it.)

### Step 4 — THE IMPORTANT ONE: read the first week's posts yourself

For week 1, set the system to save posts as **drafts** instead of publishing them.

Then read all 35 drafts. You will spot 5–10 phrases that sound like a robot wrote them. Add each
one to the blocked list:

```sql
INSERT INTO banned_phrases (pattern, reason, scope) VALUES ('the phrase', 'sounds fake', 'all');
```

**This one hour is worth more than everything else in this project.** Only you know what sounds
wrong to a Malaysian ear. The AI does not. Skip this and the system trains itself on your worst
output.

---

## 6. What to expect, and when

Being straight with you about this.

| Time | What happens | What NOT to do |
|---|---|---|
| Day 1 | Setup. First test post works. | — |
| Day 2–7 | Draft mode. You read 35 posts and build the blocked list. | Do not go live yet |
| Week 2 | Real posting starts. First clicks appear. | Do not judge anything |
| **Day 1–12** | The numbers are basically **random noise**. | **Change nothing. This is the hardest rule to follow.** |
| Day 12–24 | Patterns become real. The 3-day report starts making sense. | Change 1–2 things per cycle, max |
| Week 4–6 | First Shopee sales come in. | Do not expect much money yet |
| Month 3+ | The system has real data. This is when it compounds. | — |

**Why "change nothing" for 12 days:** you post 15 times per 3-day cycle. Fifteen is far too few
to know anything. You will see one post do well, think you found the secret, change everything to
match it — and you will have been chasing luck. Wait until day 12 minimum.

**Realistic money:** month one will probably earn less than the server costs (~RM 25–45/month).
This is normal. The value is that it improves by itself. Month 3 is where it starts paying.

**The biggest factor is not the software — it is which products you pick.** A perfect system
posting about something nobody wants earns nothing. Spend your time finding products people
actually buy, and writing real specifics in the notes box.

---

## 7. Weekly routine (15 minutes)

| How often | Do this |
|---|---|
| Weekly | Read 5 random posts. Anything robotic → add to blocked list |
| After adding books | Read the new techniques, disable any you dislike |
| Weekly | Add 1–2 new products (photos optional) |
| Weekly | Check for errors: `SELECT * FROM run_log WHERE level='error'` |
| Every 3 days | Read the report — but ignore it until day 12 |
| Day 18+ | Check photos vs text performance |
| Every 25 days | Check the Meta token got renewed automatically |

---

## 8. What is built, what is not

| Part | Ready? |
|---|---|
| Database | Yes — tested on a real database |
| Malay copy techniques (60 styles) | Yes — 43 built-in + 17 from your Books/ folder |
| PDF reader (upload copywriting books) | Yes — fully tested |
| Product upload page | Yes — all 3 input types tested |
| Click tracking (the link shortener) | Yes — tested |
| Posting automation (wf3_publish) | Yes — ready to import into n8n |
| Key auto-renewal (wf0) | Yes — ready to import |
| Writing automation (wf2_generate) | Needs 4 code blocks pasted in |
| Learning automation (wf4_evaluate) | Needs 3 code blocks pasted in |
| Shopee sales import (wf5) | Built — pulls from the Shopee Affiliate Open API (needs your keys) |

**Not tested end-to-end:** the live connections to Threads and the **Shopee Affiliate Open API**,
because I do not have your login details / API keys. The Shopee client itself (`lib/shopee.js` —
auth signature, query builders, conversion→`post_uid` mapping) is unit-tested against the
official contract and just needs your App ID + API Key from the affiliate dashboard's *Open API*
section. Everything else was tested against a real database and a real running server.

---

## 8b. Notes on your Books/ folder — worth knowing

Your 26 PDFs are already mined into the database. Three things to be aware of:

**1. Three PDFs are pictures, not text.** Nothing can be read from them until you run OCR
(optical character recognition — software that turns pictures of text into actual text).
Fix with `ocrmypdf -l msa+eng "in.pdf" "out.pdf"` then upload via the KB page.

**2. Most of your Malay books teach a style that will hurt you on Threads.** They are written for
2015 Facebook ads — *Headlines produk.pdf* alone contains 17,146 ALL-CAPS words and 492 hype
words like PERCUMA and RAHSIA TERBONGKAR. That worked then; today it is the fastest way to get
your account down-ranked.

So I kept the *thinking* from those books and **blocked the style**. The system will never write
`RAHSIA TERBONGKAR!` or `PM saya sekarang` — those are now on the banned list, taken directly
from what the books recommend doing. Their biggest value turned out to be showing exactly what
not to publish.

**3. Three techniques are marked "contested"** because your books contradict each other — for
example, the Malay books say state the benefit immediately, the storytelling books say delay it.
Rather than pick a side, both are being tested. Around cycle 6 run this and your own sales data
gives the verdict:

```sql
SELECT * FROM v_contested_verdicts;
```

Full detail in `docs/05-books.md`.

---

## 9. Things that will go wrong (and are already handled)

Built in, you do not need to do anything:

- **Facebook's own robot clicking your links** — filtered out, otherwise your numbers would be
  garbage
- **The same post going out twice** — locked
- **Posting too much and getting banned** — checks the limit before every post
- **A photo failing to load** — posts as text instead, does not lose the slot
- **Shopee price lookup** — when Shopee Open API keys are present, price + commission come
  from `productOfferV2` (authoritative). Without keys, or if a call is blocked, it falls back to
  the page's OG tags and the product still works, just with less detail
- **Indonesian words slipping in** — blocked automatically
- **Old-school hard-sell language** (PERCUMA, RAHSIA, PM saya, ALL CAPS) — blocked automatically

**You must handle these two:**

1. **Add an alert to the token-renewal workflow (wf0).** If the Meta token expires and you do not
   notice, posting silently stops for days. Add a Telegram or email notification to its failure
   branch in n8n.
2. **Back up weekly.** Run this on your VPS:
   `docker compose exec postgres pg_dump -U threadsflow threadsflow | gzip > backup.gz`
   What matters is not the code — it is everything the system has *learned*.

**The three mistakes that kill this:**

1. Acting on the first 12 days of data (it is noise, you will chase luck)
2. Skipping the click tracker (then you are optimising for likes, and likes do not pay)
3. Skipping draft week (the system learns from your worst output)

---

## Where to go next

- `docs/03-setup-runbook.md` — copy-paste setup, every step explained
- `docs/01-architecture.md` — how it works inside (technical, optional)
- `docs/02-n8n-workflows.md` — the automations, box by box (for when you need to debug)
- `docs/04-technique-library.md` — uploading copywriting PDFs
- `docs/05-books.md` — what was extracted from your 26 books, and what was rejected
- `docs/07-l4-reply-loop.md` — on-post user comment engagement loop
- `db/queries.sql` — ready-made reports you can run
