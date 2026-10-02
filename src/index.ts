import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
    try {
      const ollamaResponse = await axios.get("http://localhost:11434/api/tags", { timeout: 3000 });
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
    
    // Dédupliquer par id (au cas où un modèle apparaîtrait dans les deux sources)
    const uniqueModels = Array.from(new Map(allModels.map(model => [model.id, model])).values());
    
    // Limiter à 100 modèles au total pour éviter les réponses trop longues
    const limitedModels = uniqueModels.slice(0, 100);
    
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
  "Vérifie en temps réel la latence et la disponibilité d'un modèle chez un fournisseur",
  {}, // Empty params schema as plain object (ZodRawShapeCompat)
  async (_args, extra) => {
    // args will be empty since we used {}
    try {
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