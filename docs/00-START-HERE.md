# START HERE — read this one first

Plain-language guide. No jargon. If a word is technical, it's explained right there.

---

## 1. What this thing actually does

You give it: **a Shopee affiliate link**, plus **photos or a written description** (either is fine).

It then does this forever, by itself:

- Writes 5 posts a day in Malay, each one in a different style
- Puts them on Threads at slightly random times (so it doesn't look like a robot)
- Puts your affiliate link in the **first comment**, not in the post
- Counts who clicks and who buys
- **Every 3 days it checks which styles made money, and does more of those**

That last point is the whole idea. It's not a posting robot. It's a robot that *learns what sells*
and keeps getting better while you sleep.

**Why the link goes in the comment:** Threads shows your post to fewer people if there's an
outside link in it. Link in the comment = post stays clean = more people see it.

---

## 2. Everything is in Malay, for Malaysia

Set up for Malaysia, not Indonesia:

- Copy is written in everyday Malaysian Malay — *tak, nak, dah, je, lah* — and mixing in English
  words (rojak) is allowed, because that's how Malaysians actually post
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
poison"*. So there's an automatic filter that rejects any post containing Indonesian words
(*banget, nggak, gak, aja, udah, bikin, gimana, kalian*) before it ever gets posted. Tested and
confirmed working.

---

## 3. Three ways to add a product

| What you give it | Works? | What you get |
|---|---|---|
| Link + photos | ✅ | Posts with photos |
| Link + photos + description | ✅ | Best results |
| **Link + description only** | ✅ | **Text-only posts. No photos needed at all.** |
| Link by itself | ❌ | Rejected — see below |

**Why link-only is rejected:** with no photo and no words, the AI has nothing real to write about,
so it would invent things. Made-up details are exactly what makes affiliate posts look fake. If
you have no photos, just write 2–3 real sentences about the product (size, price, how long you've
used it) and that's enough.

**Text-only posts are not second-best.** Threads is mostly a text app, and text posts often reach
*more* people than photo posts. The system tries both and tells you which works better for your
account. Even for products where you uploaded photos, about 15% of posts will be text-only, just
to check.

---

## 4. What you have to do yourself

The system can't do these. Budget about a day, most of it waiting.

### Step 1 — Get permission from Meta (~2 hours, mostly waiting)

You need a key ("token") that lets the system post to your Threads account.

1. Go to developers.facebook.com → Create App → choose "Access the Threads API"
2. Tick these permissions: `threads_basic`, `threads_content_publish`,
   `threads_manage_insights`, `threads_manage_replies`
3. **Important shortcut:** in App roles → Threads Tester → add your own username. Then accept
   the invite in the Threads app (Settings → Website permissions).
   This lets you skip Meta's review process completely, which otherwise takes weeks.
4. Test it works by posting one message with the copy-paste command in
   `docs/03-setup-runbook.md`. **Don't build anything else until you see that test post appear.**

### Step 2 — Put the system online (~1 hour)

Follow `docs/03-setup-runbook.md`. It's copy-paste commands.

The one part people get wrong: you need 4 web addresses pointing at your server, and **two of
them must be public**:

| Address | Who needs to reach it | Locked? |
|---|---|---|
| `n8n.yourdomain.com` | just you | 🔒 lock it |
| `kb.yourdomain.com` | just you | 🔒 lock it |
| `r.yourdomain.com` | **your buyers** | 🌐 must be open |
| `cdn.yourdomain.com` | **Meta's servers** | 🌐 must be open |

If you lock the last two, buyers can't click your links and photos won't upload. This is the
number one reason people's setup silently doesn't work.

### Step 3 — Copy-paste 7 bits of code (~15 minutes)

Two of the four automations come as templates with blank spots. You open each blank spot and
paste in a file from the `n8n/code/` folder. The instructions say exactly which file goes where.

(Why isn't this done already? The code is 600 lines. Stuffing it inside the template file would
make it unreadable and impossible to fix later. Keeping it as normal files means you can actually
read and change it.)

### Step 4 — THE IMPORTANT ONE: read the first week's posts yourself

For week 1, set the system to save posts as **drafts** instead of publishing them.

Then read all 35 drafts. You will spot 5–10 phrases that sound like a robot wrote them. Add each
one to the blocked list:

```sql
INSERT INTO banned_phrases (pattern, reason, scope) VALUES ('the phrase', 'sounds fake', 'all');
```

**This one hour is worth more than everything else in this project.** Only you know what sounds
wrong to a Malaysian ear. The AI doesn't. Skip this and the system trains itself on your worst
output.

---

## 5. What to expect, and when

Being straight with you about this.

| Time | What happens | What NOT to do |
|---|---|---|
| Day 1 | Setup. First test post works. | — |
| Day 2–7 | Draft mode. You read 35 posts and build the blocked list. | Don't go live yet |
| Week 2 | Real posting starts. First clicks appear. | Don't judge anything |
| **Day 1–12** | The numbers are basically **random noise**. | **Change nothing. This is the hardest rule to follow.** |
| Day 12–24 | Patterns become real. The 3-day report starts making sense. | Change 1–2 things per cycle, max |
| Week 4–6 | First Shopee sales come in. | Don't expect much money yet |
| Month 3+ | The system has real data. This is when it compounds. | — |

**Why "change nothing" for 12 days:** you post 15 times per 3-day cycle. Fifteen is far too few
to know anything. You'll see one post do well, think you found the secret, change everything to
match it — and you'll have been chasing luck. Wait until day 12 minimum.

**Realistic money:** month one will probably earn less than the server costs (~$5–10/month).
This is normal. The value is that it improves by itself. Month 3 is where it starts paying.

**The biggest factor isn't the software — it's which products you pick.** A perfect system posting
about something nobody wants earns nothing. Spend your time finding products people actually buy,
and writing real specifics in the notes box.

---

## 6. Weekly routine (15 minutes)

| How often | Do this |
|---|---|
| Weekly | Read 5 random posts. Anything robotic → add to blocked list |
| After adding books | `SELECT code,type,instruction FROM techniques WHERE n=0` — read the new ones, disable any you dislike |
| Weekly | Add 1–2 new products (photos optional) |
| Weekly | Check for errors: `SELECT * FROM run_log WHERE level='error'` |
| Every 3 days | Read the report — but ignore it until day 12 |
| Day 18+ | Check `SELECT * FROM v_media_performance` — photos or text winning? |
| Every 25 days | Check the Meta key got renewed automatically |

---

## 7. What's built, what isn't

| Part | Ready? |
|---|---|
| Database | ✅ Tested on a real database |
| Malay copy library (60 styles) | ✅ 43 built-in + 17 from your Books/ folder |
| PDF reader (upload copywriting books) | ✅ Fully tested |
| Product upload page | ✅ All 3 input types tested |
| Click tracking | ✅ Tested |
| Posting automation | ✅ Ready to import |
| Key auto-renewal | ✅ Ready to import |
| Writing automation | ⚠️ Import + paste 4 code blocks |
| Learning automation | ⚠️ Import + paste 3 code blocks |
| Shopee sales import | ❌ Not built — works on click data until you add it |

**Not tested:** the actual connection to Threads and Shopee, because I don't have your login
details. Everything else was tested against a real database and a real running server.

---

## 7b. Notes on your Books/ folder — worth knowing

Your 26 PDFs are already mined into the database. Three things to be aware of:

**1. Three PDFs are pictures, not text.** Nothing can be read from them until you run OCR:
`50 Headline Power Proven.pdf`, `TEKNIK COPYWRITING.pdf`, `Ebook - Strategi Tulis Headline
Sentap Emosi.pdf`. Fix with `ocrmypdf -l msa+eng "in.pdf" "out.pdf"` then upload via the KB page.

**2. Most of your Malay books teach a style that will hurt you on Threads.** They're written for
2015 Facebook ads — `Headlines produk.pdf` alone contains 17,146 ALL-CAPS words and 492 hype
words like PERCUMA and RAHSIA TERBONGKAR. That worked then; today it's the fastest way to get
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

## 8. Things that will go wrong (and are already handled)

Built in, you don't need to do anything:

- **Facebook's own robot clicking your links** — filtered out, otherwise your numbers would be
  garbage
- **The same post going out twice** — locked
- **Posting too much and getting banned** — checks the limit before every post
- **A photo failing to load** — posts as text instead, doesn't lose the slot
- **Shopee blocking the price lookup** — product still works, just with less detail
- **Indonesian words slipping in** — blocked automatically
- **Old-school hard-sell language** (PERCUMA, RAHSIA, PM saya, ALL CAPS) — blocked automatically,
  including a check that rejects any post with 3+ shouted words

**You must handle these two:**

1. **Add an alert to the key-renewal automation.** If the Meta key expires and you don't notice,
   posting silently stops for days. Add a Telegram or email step to its failure branch.
2. **Back up weekly.** `docker compose exec postgres pg_dump -U threadsflow threadsflow | gzip > backup.gz`
   What matters isn't the code — it's everything the system has *learned*.

**The three mistakes that kill this:**

1. Acting on the first 12 days of data (it's noise, you'll chase luck)
2. Skipping the click tracker (then you're optimising for likes, and likes don't pay)
3. Skipping draft week (the system learns from your worst output)

---

## Where to go next

- `docs/03-setup-runbook.md` — copy-paste setup, step by step
- `docs/01-architecture.md` — how it works inside
- `docs/02-n8n-workflows.md` — the automations, box by box
- `docs/04-technique-library.md` — uploading copywriting PDFs
- `docs/05-books.md` — **what was extracted from your 26 books, and what was rejected**
- `db/queries.sql` — ready-made reports you can run
