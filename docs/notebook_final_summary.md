## 17. Final summary

**Objective.** Forecast monthly sales of a newly launched flavored water from its first year of data, compare forecasting models with MAPE and WAPE, and use an LLM to interpret the results from the data as it stands at that moment.

### Approach

| Step | What was done |
|---|---|
| Data | Kaggle *FMCG Daily Sales Data (2022–2024)* (CC0, synthetic). SKU JU-021 stands in for the new product: 3 regions × 3 channels, first year Aug 2022 – Jul 2023. The 17 later months are held back and replayed as "real-time" data. |
| Task 1: Preprocessing | Daily rows aggregated to monthly units; partial launch month excluded. Features: lags 1 and 2 (plus lag 3 and a 3-month rolling mean from 12 training months, and lag 12 from 24), seasonal indicators (month as sine/cosine, summer flag), months since launch, days in month, and region and channel indicators. |
| Task 2: Models | Naive, Seasonal Naive, ARIMA (order chosen by AICc), Random Forest and XGBoost (pooled over the 9 region × channel series). |
| Task 3: Split | Chronological, never random: 9 training months (Aug 2022 – Apr 2023) and a 3-month test window (May – Jul 2023). |
| Task 4: Forecast | The next 3 months (Aug – Oct 2023), with 80% and 95% ranges. |
| Task 5: Metrics | MAPE = mean of \|A − F\| / \|A\| × 100 (zero actuals excluded and reported). WAPE = Σ\|A − F\| / Σ\|A\| × 100. Checked by hand: Naive MAPE 13.71%, WAPE 2,391 / 17,274 = 13.84%. |
| Task 6: Plots | Actual vs predicted for every model on the test window and the forecast horizon. |
| Task 7: Interpretation | Analyst reading (§12), LLM interpretation (§15), business summary (§16). |

### First-year results (test window May – Jul 2023)

| Model | MAPE | WAPE | Bias |
|---|---|---|---|
| **Naive** | **13.7%** | **13.8%** | −13.8% |
| **ARIMA(0,1,0)** | **13.7%** | **13.8%** | −13.8% |
| Random Forest | 20.2% | 20.3% | −20.3% |
| XGBoost | 22.3% | 22.5% | −22.5% |
| Seasonal Naive | not evaluated: needs 12 months of training history | | |

**Forecast for Aug – Oct 2023 (best model):** 5,661 units per month. The 80% range widens from 4,776–6,546 in August to 4,128–7,194 in October.

### Answers to the three questions

1. **Seasonality and trends.**
   - The trend was captured only as the recent level: sales rose 32.6% from the previous three months to the last three, with a peak of 6,072 units in June 2023.
   - Seasonality was **not** captured in year one: no calendar month had yet been seen twice, and every model under-forecast the first summer (negative bias).
   - With 29 months of data, seasonality becomes learnable. The seasonal models then track it closely: WAPE 1.4% for Seasonal Naive and 1.6% for ARIMA on Oct – Dec 2024.
2. **Best model, and why.**
   - In year one, **Naive and ARIMA(0,1,0) tie** with WAPE 13.8%. ARIMA chose a random walk, which produces the same forecast as Naive: with 9 noisy months, the latest level is the most reliable signal, and the ML models had too little history.
   - As data accumulates, **Seasonal Naive** wins the latest window, and **Random Forest** has the best long-run record (tracked WAPE 14.8% vs 24.2% for Naive over 48 forecasts per model). Pooling the 9 series pays off as history grows.
3. **Recommendations.**
   - Plan production from the simple forecast with a buffer up to the 80% upper bound, and re-forecast monthly.
   - Switch to seasonal models once 24 months exist, and build stock ahead of summer: summer months average about 57% above winter.
   - Allocate by the recent regional and channel mix.
   - Use promotions, which sell about 1.9× a normal day, to lift off-season demand.
   - Size safety stock from ARIMA's prediction ranges.

### Business impact

Planning May – Jul 2023 on the best first-year forecast would have left production **2,391 units short (13.8% of the 17,274 units sold)**. Over the following 17 months, choosing Random Forest instead of Naive would have cut mis-planned volume from about 24 to about 15 units per 100 sold.

### LLM integration on real-time data

- **What the LLM receives.** Numeric facts computed from the data available at that moment: metrics, forecasts, trend, seasonality and operations signals. Each time a new month arrives, the facts are rebuilt and the LLM interpretation is regenerated.
- **Which LLM.** Free NVIDIA API Catalog models, with an optional Claude route. The key is read from an environment variable or Colab Secrets and is never written in the notebook.
- **Grounding.** The prompt forbids invented numbers, and a grounding check verifies every figure and evidence key against the facts.
- **Fallback.** If no LLM is available, a labelled rule-based interpretation answers the same three questions.

### Deliverables

- **This notebook.**
- **The interactive dashboard:** https://flowcastai.netlify.app. It runs the same Python engine live in the browser, adds months one at a time, and regenerates the AI interpretation.
- **Source code:** https://github.com/KartikJoshi23/FlowCast

### Limitations

- The data is synthetic, and a juice stands in for the flavored water.
- The first-year test window is only 3 months.
- Seasonality cannot be estimated until 24 months of history exist, so first-year forecasts carry wide uncertainty ranges.
