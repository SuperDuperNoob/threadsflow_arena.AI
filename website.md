# ThreadsFlow — All Built-In Web URLs

Your system exposes **3 public hostnames** via Cloudflare Tunnel, plus the **n8n internal port**. Here's every URL you can access:

---

## 🟢 1. n8n — Automation Dashboard
| | |
|---|---|
| **URL** | `https://n8n-threads.archxry.space` |
| **Internal** | `http://n8n:5678` |
| **Login** | `naimmulmukin@gmail.com` / your n8n password |
| **Purpose** | Create, edit, monitor, and run all automation workflows |

### What you can do here:
- View and edit **all workflows** (wf1–wf7: content generation, publishing, reply management, performance scoring, topic refresh, etc.)
- **Execute workflows** manually or check scheduled runs
- View **execution history** and debug failed runs
- Manage **credentials** (Threads token, LLM API keys, etc.)
- Access the **webhook endpoints** used by other services

---

## 🟢 2. KB (Knowledge Base) — Product & Content Management
| | |
|---|---|
| **URL** | `https://kb-threads.archxry.space` *(based on the naming pattern in your .env; actual domain is set in Cloudflare Tunnel config)* |
| **Internal** | `http://kb:8082` |
| **Login** | Password: set in `KB_PASSWORD` |
| **Purpose** | Upload PDFs, manage products, review content, configure LLM settings |

### Pages:

| Page | URL Path | What It Does |
|------|----------|--------------|
| **Home / PDF Upload** | `/` or `/index.html` | Upload affiliate PDFs → auto-mined into knowledge base chunks |
| **Product Intake** | `/product.html` | Add Shopee products (name, link, price, images) for the system to promote |
| **Post Queue** | `/queue.html` | View generated posts waiting in queue, approve/reject/edit before publishing |
| **Product Research** | `/research.html` | Run Shopee product research (Apify-based scraping) to discover high-commission products |
| **Chunk Review** | `/review.html` | Review and approve/reject auto-mined knowledge chunks from PDFs |
| **Settings** | `/settings.html` | Configure LLM models, API keys, base URLs, and system settings |

### API Endpoints (for automation / debugging):
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/login` | POST | Authenticate with KB_PASSWORD |
| `/api/upload` | POST | Upload PDF files |
| `/api/documents` | GET | List all uploaded documents |
| `/api/documents/:id` | GET | Get document details + chunks |
| `/api/documents/:id` | DELETE | Delete a document |
| `/api/documents/:id/retry` | POST | Re-mine a failed document |
| `/api/stats` | GET | Knowledge base statistics |
| `/api/products` | GET/POST | List or add products |
| `/api/techniques` | GET | List copywriting techniques |
| `/api/review` | GET | Get chunks pending review |
| `/api/review/lock` | POST | Lock a chunk for review |
| `/api/review/:id` | POST | Submit review decision |
| `/api/review/queue` | GET | Review queue overview |
| `/api/review/summary` | GET | Review summary stats |
| `/api/config/llm` | GET/PUT | Read/update LLM configuration |
| `/api/config/llm/test` | POST | Test LLM connectivity |
| `/api/config/system/:key` | GET/PUT | Read/update system settings |
| `/api/posts/queue` | GET | Get posts in queue |
| `/api/posts/:id/lock` | POST | Lock a post for review |
| `/api/posts/:id/decision` | POST | Approve/reject a post |
| `/api/posts/weekly` | GET | Weekly posting statistics |
| `/api/kb/techniques-for-generation` | GET | Techniques data for n8n workflows |
| `/api/shopee/status` | GET | Shopee API integration status |
| `/api/apify/status` | GET | Apify integration status |
| `/api/apify/keys` | GET/POST | Manage Apify API keys |
| `/api/research/shopee` | POST | Trigger Shopee product research |
| `/api/research/shopee/runs` | GET | List research runs |
| `/api/import/conversions` | POST | Import Shopee conversion data |
| `/img/*` | GET | Serve uploaded product images (if `IMAGE_BACKEND=local`) |
| `/healthz` | GET | Health check (no auth) |

---

## 🟢 3. Redirector — Link Shortener & Click Tracker
| | |
|---|---|
| **URL** | `https://r-threads.archxry.space` |
| **Internal** | `http://redirector:8081` |
| **Auth** | **None (public)** — buyers/visitors hit this |
| **Purpose** | Short affiliate links in posts redirect to Shopee product pages while tracking clicks |

### Paths:
| Path | Purpose |
|------|---------|
| `/p/<post_uid>` | **Redirect link** — visitors click this in Threads posts, get redirected to the Shopee product URL. Tracks the click. |
| `/ping.js` | Client-side engagement pixel (tracks page views) |
| `/ping` | Server-side engagement ping endpoint |
| `/healthz` | Health check |

---

## 🟢 4. CDN — Image Hosting (Cloudflare R2)
| | |
|---|---|
| **URL** | `https://cdn-threads.archxry.space` |
| **Auth** | **None (public)** — Meta/Threads fetches images from here |
| **Purpose** | Serves product images uploaded via KB. Used in Threads posts so Meta can render image cards. |

> [!NOTE]
> This is a Cloudflare R2 public bucket, not a Docker service. Images are uploaded by the KB service using S3-compatible API and served directly by Cloudflare's CDN.

---

## Summary Table

| Service | URL | Auth | Purpose |
|---------|-----|------|---------|
| **n8n** | `https://n8n-threads.archxry.space` | Email + Password | Workflow editor & automation dashboard |
| **KB** | `https://kb-threads.archxry.space` | `KB_PASSWORD` | PDF upload, product intake, post queue, settings |
| **Redirector** | `https://r-threads.archxry.space` | Public | Affiliate link redirects + click tracking |
| **CDN** | `https://cdn-threads.archxry.space` | Public | Product image hosting |

> [!TIP]
> The KB and n8n hostnames are protected by **Cloudflare Access** policies. The Redirector and CDN are intentionally public so buyers and Meta's servers can access them.
