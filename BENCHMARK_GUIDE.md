# 🎙️ Speech Pronunciation & Fluency Assessment: 3-Model Benchmark Notebook

This directory contains the complete Jupyter Notebook and Python pipeline for training and benchmarking three speech assessment architectures:

1. **`Speech_Pronunciation_and_Fluency_Benchmarking.ipynb`**: Complete, self-contained, publication-ready Jupyter Notebook.
2. **`benchmark_runner.py`**: Standalone Python script for headless execution or automated testing.

---

## 🚀 How to Run in Kaggle or Google Colab

### Running on Kaggle
1. Go to [kaggle.com/code](https://www.kaggle.com/code).
2. Click **New Notebook** -> **File** -> **Upload Notebook**.
3. Select `Speech_Pronunciation_and_Fluency_Benchmarking.ipynb`.
4. Under **Settings** on the right sidebar:
   - Turn **GPU** on (T4 x2 or P100 for fast neural training).
   - Turn **Internet** on (for Hugging Face / pip packages).
5. Click **Run All**.

### Running on Google Colab
1. Go to [colab.research.google.com](https://colab.research.google.com).
2. Click **Upload** and upload `Speech_Pronunciation_and_Fluency_Benchmarking.ipynb`.
3. In the menu: **Runtime** -> **Change runtime type** -> Select **T4 GPU**.
4. Click **Runtime** -> **Run all**.

---

## 🏗️ The 3 Benchmarked Architectures

| Model | Paradigm | Input Representation | Key Strengths |
| :--- | :--- | :--- | :--- |
| **Model 1: GBR Baseline** | Classical Acoustic Ensemble | 32 Handcrafted Prosodic + MFCC Stats | Highly interpretable, Gini feature attribution, ultra-low latency (<2ms) |
| **Model 2: BiLSTM + Attention** | Temporal Sequence Deep Learning | Time-series frame sequence ($T \times 15$) | Captures temporal rhythm, vowel duration & pauses via self-attention |
| **Model 3: Speech Transformer** | Self-Supervised Learning (SSL) | Raw 16kHz audio waveform ($T \times 1$) | State-of-the-art representation learning, temporal Conv1D front-end |

---

## 📊 Evaluation Metrics Computed

- **Pearson Correlation ($r$)**: Linear correlation against expert human raters (INTERSPEECH gold standard).
- **Spearman Rank Correlation ($\rho$)**: Monotonic rank agreement.
- **RMSE & MAE**: Scoring deviation error on 0–100 scale.
- **$R^2$ Variance Explained**: Goodness of fit.
- **Quadratic Weighted Kappa (QWK)**: Educational assessment agreement across 5 score bands (CEFR A1–C2).
- **Inference Latency**: Milliseconds per utterance.

---

## 📈 Generated Visualizations
The notebook generates a 9-panel diagnostic figure (`speech_benchmark_diagnostic_panel.png`):
1. **Training & Validation Loss Convergence**
2. **Validation Pearson Correlation ($r$) Progression**
3. **Multi-Metric Radar / Spider Benchmark Chart**
4. **Model 1 Scatter Plot (Predicted vs Human Ground Truth)**
5. **Model 2 Scatter Plot with Linear Fit & Confidence**
6. **Model 3 Scatter Plot with Linear Fit & Confidence**
7. **Error Residual Density Distributions (KDE)**
8. **Top Acoustic Features for Speech Fluency (Gini Feature Importance)**
