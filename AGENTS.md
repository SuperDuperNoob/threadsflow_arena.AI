# AGENTS.md — Guidelines for Codex and AI Coding Agents

Welcome to **ThreadsFlow** (`threadsflow_arena.AI`). This document outlines rules, technical constraints, and domain standards for AI coding assistants working in this repository.

## Project Overview
ThreadsFlow is an automated social media affiliate marketing system for the Malaysian market on Threads. It combines PostgreSQL, n8n automation workflows, and custom Node.js microservices to generate, evaluate, publish, and optimize posts and replies using a multi-armed bandit algorithm.

## Key Rules & Constraints

1. **Malaysian Malay Language Standards:**
   - Use casual Malaysian Malay (`tak`, `nak`, `dah`, `je`, `lah`, `kan`, `kot`, `memang`, `boleh`).
   - **Never use Indonesian words** (`banget`, `nggak`, `gak`, `aja`, `udah`, `bikin`, `gimana`, `kalian`, `doang`, `cowok`, `cewek`, `gue`, `deh`, `dong`, `sih`).
   - Currency is RM. Never Rp.

2. **Architecture & Resource Discipline:**
   - Designed for a 4GB RAM / 2 vCPU server. Avoid memory-heavy synchronous operations or unstructured loops.
   - Keep PDF mining and knowledge base ingestion asynchronous and serial (`services/kb/`).

3. **Database & Queries:**
   - SQL schema updates must use sequential migration scripts in `db/migrations/`.
   - Preserve existing views (`v_post_performance`, `v_technique_performance`, etc.) used by queries and dashboards.

4. **Code Quality & Testing:**
   - Validate JS code files using Node check (`npm --prefix services/kb run check`).
   - Run unit tests (`npm --prefix services/kb test`) before proposing modifications.
