import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const server = new McpServer(
  {
    name: "model-discovery",
    version: "1.0.0"
  },
  {
    capabilities: {
      resources: {},
      tools: {}
    }
  }
);

// Ressource pour lister les modèles gratuits disponibles (OpenRouter + Ollama local)
  server.resource(
    "Liste des modèles LLM gratuits disponibles en temps réel",
    "model://available/free",
    async () => {
      let allModels: any[] = [];
      
      // 1. Essayer de récupérer les modèles locaux depuis Ollama
    // /api/tags liste aussi les modèles :cloud -> peut prendre >30s
    try {
      const ollamaResponse = await axios.get("http://localhost:11434/api/tags", { timeout: 45000 });
      if (ollamaResponse.data && ollamaResponse.data.models) {
        const ollamaModels = ollamaResponse.data.models.map((model: any) => ({
          id: model.name,
          name: model.name,
          description: `Local Ollama model${model.details?.family ? ` (${model.details.family})` : ""}${model.details?.parameter_size ? ` ${model.details.parameter_size}` : ""}`,
          context_length: 0, // Ollama API doesn't provide context length directly; could be inferred from model but not available here
          architecture: {
            modality: "text->text", // Simplification; Ollama models can be multimodal but we don't have that info easily
            input_modalities: ["text"],
            output_modalities: ["text"],
            tokenizer: model.details?.tokenizer || "Unknown",
            instruct_type: null
          }
        }));
        allModels = [...allModels, ...ollamaModels];
      }
    } catch (ollamaError: any) {
      // Ollama not available or error, continue with OpenRouter only
      console.warn("Could not fetch Ollama models:", ollamaError.message);
    }
    
    // 2. Récupérer les modèles gratuits depuis OpenRouter
    try {
      const openrouterResponse = await axios.get("https://openrouter.ai/api/v1/models", {
        timeout: 5000
      });
      
      const models = openrouterResponse.data.data || [];
      
      // Filtrer pour ne garder que les modèles réellement gratuits (prix = 0)
      const freeModels = models
        .filter((model: any) => 
          !!model.pricing && 
          model.pricing.prompt === "0" && 
          model.pricing.completion === "0"
        )
        .map((model: any) => ({
          id: model.id,
          name: model.name || model.id,
          description: model.description || "",
          context_length: model.context_length || 0,
          architecture: model.architecture || {}
        }));
      
      allModels = [...allModels, ...freeModels];
    } catch (openrouterError: any) {
      console.warn("Could not fetch OpenRouter models:", openrouterError.message);
      // If both fail, we'll return what we have (possibly just Ollama)
    }

    // 3. Catalogue NVIDIA NIM servi au compte (clé en env utilisateur)
    try {
      const nimBase = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
      const nimKey = process.env.NVIDIA_API_KEY;
      if (nimKey) {
        const nimResponse = await axios.get(`${nimBase}/models`, {
          timeout: 15000,
          headers: { Authorization: `Bearer ${nimKey}` }
        });
        const nimModels = (nimResponse.data.data || []).map((m: any) => ({
          id: m.id,
          name: m.id,
          description: `NVIDIA NIM${m.owned_by ? ` (${m.owned_by})` : ""}`,
          context_length: 0,
          architecture: {
            modality: "text->text",
            input_modalities: ["text"],
            output_modalities: ["text"],
            tokenizer: "Unknown",
            instruct_type: null
          }
        }));
        allModels = [...allModels, ...nimModels];
      }
    } catch (nimError: any) {
      console.warn("Could not fetch NVIDIA NIM models:", nimError.message);
    }

    // 4. Catalogue Groq (cle en env utilisateur, OpenAI-compatible)
    try {
      const groqKey = process.env.GROQ_API_KEY;
      if (groqKey) {
        const groqResponse = await axios.get("https://api.groq.com/openai/v1/models", {
          timeout: 15000,
          headers: { Authorization: `Bearer ${groqKey}` }
        });
        const groqModels = (groqResponse.data.data || []).map((m: any) => ({
          id: `groq/${m.id}`,
          name: m.id,
          description: "Groq",
          context_length: 0,
          architecture: {
            modality: "text->text",
            input_modalities: ["text"],
            output_modalities: ["text"],
            tokenizer: "Unknown",
            instruct_type: null
          }
        }));
        allModels = [...allModels, ...groqModels];
      }
    } catch (groqError: any) {
      console.warn("Could not fetch Groq models:", groqError.message);
    }

    // 5. Catalogue HuggingFace router (cle en env utilisateur, OpenAI-compatible)
    try {
      const hfKey = process.env.HF_TOKEN;
      if (hfKey) {
        const hfResponse = await axios.get("https://router.huggingface.co/v1/models", {
          timeout: 15000,
          headers: { Authorization: `Bearer ${hfKey}` }
        });
        const hfModels = (hfResponse.data.data || []).map((m: any) => ({
          id: `hf/${m.id}`,
          name: m.id,
          description: "HuggingFace router",
          context_length: 0,
          architecture: {
            modality: "text->text",
            input_modalities: ["text"],
            output_modalities: ["text"],
            tokenizer: "Unknown",
            instruct_type: null
          }
        }));
        allModels = [...allModels, ...hfModels];
      }
    } catch (hfError: any) {
      console.warn("Could not fetch HuggingFace models:", hfError.message);
    }

    // Dédupliquer par id (au cas où un modèle apparaîtrait dans les deux sources)
    const uniqueModels = Array.from(new Map(allModels.map(model => [model.id, model])).values());

    // Limiter à 250 modèles au total pour éviter les réponses trop longues
    const limitedModels = uniqueModels.slice(0, 250);
    
    return {
      contents: [
        {
          uri: "model://available/free",
          mimeType: "application/json",
          text: JSON.stringify(limitedModels, null, 2)
        }
      ]
    };
  }
);

// Outil pour pinger un fournisseur spécifique et vérifier la disponibilité d'un modèle
server.tool(
  "ping-supplier",
  "Vérifie en temps réel la disponibilité d'un fournisseur (openrouter par défaut ; ollama | nim | nim2 | groq | hf supportés)",
  {
    supplier: z.string().optional().describe("openrouter (defaut) | ollama | nim | nim2 | groq | hf")
  },
  async (args: any, extra) => {
    const supplier = (args?.supplier || "openrouter").toLowerCase();
    try {
      if (supplier === "ollama") {
        const started = Date.now();
        const r = await axios.get("http://localhost:11434/api/tags", { timeout: 45000 });
        const models = (r.data?.models || []).map((m: any) => ({ id: m.name, name: m.name }));
        return {
          content: [{ type: "text", text: JSON.stringify({
            supplier, available: true, latencyMs: Date.now() - started,
            modelCount: models.length, models: models.slice(0, 50),
            timestamp: new Date().toISOString() }, null, 2) }]
        };
      }
      if (supplier === "nim" || supplier === "nim2") {
        const nimBase = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
        const keyEnv = supplier === "nim2" ? "NVIDIA_API_KEY_2" : "NVIDIA_API_KEY";
        const nimKey = process.env[keyEnv];
        if (!nimKey) throw new Error(`${keyEnv} absente de l'env`);
        const started = Date.now();
        const r = await axios.get(`${nimBase}/models`, {
          timeout: 15000, headers: { Authorization: `Bearer ${nimKey}` }
        });
        const models = (r.data?.data || []).map((m: any) => ({ id: m.id, name: m.id }));
        return {
          content: [{ type: "text", text: JSON.stringify({
            supplier, available: true, latencyMs: Date.now() - started,
            modelCount: models.length, models: models.slice(0, 50),
            timestamp: new Date().toISOString() }, null, 2) }]
        };
      }
      if (supplier === "groq") {
        const groqKey = process.env.GROQ_API_KEY;
        if (!groqKey) throw new Error("GROQ_API_KEY absente de l'env");
        const started = Date.now();
        const r = await axios.get("https://api.groq.com/openai/v1/models", {
          timeout: 15000, headers: { Authorization: `Bearer ${groqKey}` }
        });
        const models = (r.data?.data || []).map((m: any) => ({ id: `groq/${m.id}`, name: m.id }));
        return {
          content: [{ type: "text", text: JSON.stringify({
            supplier, available: true, latencyMs: Date.now() - started,
            modelCount: models.length, models: models.slice(0, 50),
            timestamp: new Date().toISOString() }, null, 2) }]
        };
      }
      if (supplier === "hf" || supplier === "huggingface") {
        const hfKey = process.env.HF_TOKEN;
        if (!hfKey) throw new Error("HF_TOKEN absent de l'env");
        const started = Date.now();
        const r = await axios.get("https://router.huggingface.co/v1/models", {
          timeout: 15000, headers: { Authorization: `Bearer ${hfKey}` }
        });
        const models = (r.data?.data || []).map((m: any) => ({ id: `hf/${m.id}`, name: m.id }));
        return {
          content: [{ type: "text", text: JSON.stringify({
            supplier: "hf", available: true, latencyMs: Date.now() - started,
            modelCount: models.length, models: models.slice(0, 50),
            timestamp: new Date().toISOString() }, null, 2) }]
        };
      }
      const response = await axios.get("https://openrouter.ai/api/v1/models", {
        timeout: 5000
      });

      const models = response.data.data || [];
      const freeModels = models
        .filter((model: any) =>
          !!model.pricing &&
          model.pricing.prompt === "0" &&
          model.pricing.completion === "0"
        )
        .slice(0, 10);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              supplier,
              available: true,
              modelCount: freeModels.length,
              models: freeModels.map((m: any) => ({
                id: m.id,
                name: m.name || m.id
              })),
              timestamp: new Date().toISOString()
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              available: false,
              error: String(error),
              timestamp: new Date().toISOString()
            }, null, 2)
          }
        ]
      };
    }
  }
);

// Démarrage du serveur
async function main() {
  const transport = process.argv[2] === "stdio" 
    ? new StdioServerTransport()
    : new StreamableHTTPServerTransport({
        sessionIdGenerator: () => Math.random().toString(36).substr(2, 9)
      });
  
  await server.connect(transport);
  console.error("Model Discovery MCP Server running on stdio");
}

main().catch(error => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});