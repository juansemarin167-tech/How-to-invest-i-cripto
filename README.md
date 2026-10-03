# Buy weather

A one-page site that gives crypto a daily "temperature" from 0 (cold, cheap) to 100 (hot, stretched), so you can size regular buys: more when it's cold, less when it's hot.

## How the temperature works

Each day gets a weighted score from four signals:

| Signal | Weight | Cold when… | Hot when… |
|---|---|---|---|
| Price ÷ 200-day average (Mayer multiple) | 35% | below 1.0 | above 1.8 |
| Market mood (alternative.me Fear & Greed) | 25% | fear | greed |
| 14-day RSI | 20% | under 30 | over 70 |
| Position in the past year's range | 20% | near the low | near the high |

Bands and suggested buy size: Freezing (<25) 2×, Cold (25–44) 1.5×, Mild (45–59) 1×, Warm (60–74) 0.5×, Hot (75+) 0.25×.

The page also backtests the last year: fixed-amount buys vs temperature-sized buys on the same schedule.

## Run it

No build step. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

To publish, enable GitHub Pages on this branch (root folder).

`artifact/buy-weather.html` is a single-file copy of the site (CSS and JS inlined) published as a Claude artifact: https://claude.ai/artifact/3afSR29eDetBaXga78j2Hh. The artifact viewer blocks outside requests, so that copy falls back to clearly labelled example data there; opened anywhere else it uses live prices.

Data: Binance public market data (`data-api.binance.vision`), CoinGecko as backup, alternative.me Fear & Greed index. All free and keyless.

**Not financial advice.** The signals describe where price sits against its own history; they can't predict the future.
