<p align="center">
  <img src="https://raw.githubusercontent.com/art-qalam-fr/Hephaistos-Kit/main/logo/hephaistos-kit_banderole.jfif" alt="Hephaistos-Kit" width="640"/>
</p>

> Ce dépôt est un **composant MCP du [Hephaistos-Kit](https://github.com/art-qalam-fr/Hephaistos-Kit)** —
> utilisable seul, mais conçu pour être cloné en sous-module et installé via `mcp/install.ps1`.
>
> ✍️ Élaboré par **art-qalam-fr**.

---

# model-discovery-mcp

Serveur MCP de **découverte de modèles en temps réel** : interroge les
catalogues des providers configurés (NVIDIA NIM, OpenRouter, Mistral, Groq…)
et teste leur disponibilité pour connaître les modèles réellement utilisables.

## Installation

```bash
npm install && npm run build
```

## Utilisation

- Outils MCP de listing/ping des modèles par provider
- `show_models.js` — script autonome pour afficher le catalogue complet

## Configuration

Les clés provider se passent par variables d'environnement
(`NVIDIA_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `GROQ_API_KEY`…).
Un provider sans clé est simplement ignoré.

Licence MIT.
