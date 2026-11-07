# 🧠 Pool Equipment Advisor

**Live:** https://tfpleebo.github.io/Equipment-Agent/Pool%20Equipment%20Advisor.html

**Pump, Salt System (SWG) & Filter Selection Assistant**

## 📌 Overview

The Pool Equipment Advisor AI is designed to help pool owners select the **right Salt Water Generator (SWG)** and **pool pump** based on their pool setup, usage, and goals.

This agent simplifies a traditionally confusing process by translating pool chemistry principles and equipment sizing rules into clear, actionable recommendations.

The goal is not just to recommend products—but to guide users toward **reliable, efficient, and properly sized systems** that align with Trouble Free Pool (TFP)-style care.

---

## 🎯 Core Goals

* Recommend correctly sized **SWGs** (never undersized)
* Recommend efficient and appropriate **pool pumps**
* Educate users while guiding decisions (not just output answers)
* Reduce reliance on pool store advice and guesswork
* Align with **data-driven pool care principles**

---

## 🧩 Key Principles

### 1. Oversize the SWG (Critical Rule)

* SWGs should be rated for **2x–3x pool volume**
* Undersized SWGs lead to:

  * Inability to maintain FC
  * Excessive runtime
  * Premature cell wear

👉 The agent should *default to recommending larger units*, not minimum viable ones.

---

### 2. Pumps Should Match the System (Not Be Maximized)

* Bigger is NOT always better
* Focus on:

  * Energy efficiency
  * Circulation needs (not “turnover myths”)
  * Compatibility with SWG flow requirements

👉 Prefer **variable-speed pumps (VS pumps)** when possible.

---

### 3. Real-World Usability Matters

Recommendations should consider:

* Ease of installation
* Availability of replacement parts
* Reliability history
* User skill level

---

### 4. Avoid Pool Store Bias

* Do NOT default to:

  * “1 turnover per day” rules
  * Overselling horsepower
  * Undersizing SWGs to reduce upfront cost

---

## 📥 Required Inputs

The agent should gather (or estimate) the following:

### Pool Basics

* Pool volume (gallons)
* Pool type (in-ground / above-ground)
* Surface type (vinyl, plaster, fiberglass)

### Environment

* Location / climate (optional but helpful)
* Sun exposure (low / medium / high)
* Usage level (light / moderate / heavy)

### Existing Equipment (if applicable)

* Current pump type & HP
* Filter type (sand, cartridge, DE)
* Plumbing size (if known)

### User Preferences

* Budget range
* Noise sensitivity
* Energy efficiency priority
* Willingness to DIY install

---

## ⚙️ Decision Logic

### SWG Sizing Logic

1. Start with pool volume
2. Multiply by **2x–3x**
3. Adjust upward for:

   * High sun exposure
   * Heavy usage
   * Warmer climates

**Output:**

* Minimum recommended cell size
* Preferred (ideal) size
* Example models

---

### Pump Selection Logic

1. Determine pool type + plumbing limitations
2. Default to **Variable Speed Pump**
3. Size for:

   * Adequate flow for SWG
   * Energy efficiency at low RPM
4. Avoid oversized single-speed pumps

**Output:**

* Pump type recommendation (VS / single-speed if needed)
* Suggested HP range
* Example models

---

## 📤 Output Format

The agent should return responses in a structured, user-friendly format:

### Example Output

**🔧 Recommended SWG**

* Minimum Size: 40,000 gallons
* Ideal Size: 60,000 gallons
* Why: Provides headroom for summer demand and extends cell life

**⚡ Recommended Pump**

* Type: Variable Speed
* Suggested Range: 1.5–2.7 HP
* Why: Efficient low-speed operation + compatible with SWG flow needs

**💡 Notes**

* Your pool has high sun exposure → higher chlorine demand
* Oversizing the SWG reduces runtime and maintenance

---

## 🚧 Guardrails

The agent should **NOT**:

* Recommend undersized SWGs to save money
* Suggest “shock weekly” or pool store methods
* Promote unnecessary add-ons (algaecides, clarifiers, etc.)
* Rely on outdated turnover rules

---

## 🧠 Future Enhancements

* Integration with PoolMath data:

  * FC trends
  * Daily chlorine loss
* Regional recommendations based on climate
* Energy cost optimization (kWh analysis)
* Product availability by retailer
* Smart upsell: “best value vs budget vs premium”

---

## 🔗 Alignment with PoolMath Ecosystem

This agent is designed to:

* Complement PoolMath recommendations
* Improve user onboarding into proper pool care
* Reduce bad equipment purchases early in the lifecycle

---

## 🧪 Philosophy

> “Correct sizing prevents problems before they start.”

This agent prioritizes:

* Prevention over correction
* Simplicity over complexity
* Data over guesswork

---

## 🗂️ Project layout

| Path | What |
|---|---|
| `Pool Equipment Advisor.html` | the web page (wizard + results) |
| `engine/advisor.js` | the sizing engine, no screen code; reusable in other apps |
| `data/*.json` | pump, salt cell and filter catalogs plus the sizing rules |
| `data/advisor-data.js` | generated from the JSON; the page loads this |
| `docs/RULES.md` | every rule in plain English, plus open questions |
| `docs/DATA.md` | what each data field means and how to update it |
| `docs/POOLMATH-HANDOFF.md` | how PoolMath can embed or rebuild the advisor |
| `docs/UPDATING.md` | how to refresh the pump, filter and salt-cell catalogs and the rules |
| `data/CHANGELOG.md` | what changed in each catalog release |
| `tools/` | data build, catalog validator, importers, `check-all`, `impact` |
| `sources/` | the downloaded and researched source data behind the catalog |
| `tests/` | golden cases (`node tests/run.mjs`), input checks (`node tests/validation.mjs`), robustness sweep (`node tests/sweep.mjs`) |
| `pool-advisor-chatbot.html` | separate experimental chat version (OpenAI via a Cloudflare Worker) |

**After editing data:** run `node tools/build-data.mjs`, then `node tools/check-all.mjs` (CI runs the same on every push). Full process: `docs/UPDATING.md`.
The page must be published together with the `data/` and `engine/` folders.

## 🛠️ Status

🚧 In Development — Iterating on logic, inputs, and real-world recommendations
