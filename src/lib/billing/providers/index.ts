import { FactuplanProvider } from "./factuplan";
import { MockBillingProvider } from "./mock";
import type { BillingProvider } from "./types";
import type { ProviderName } from "../types";

export * from "./types";

const instances = new Map<ProviderName, BillingProvider>();

/**
 * Único punto donde se elige el proveedor. Para añadir Security Data u otro:
 * crear la clase que implemente BillingProvider y registrarla aquí.
 */
export function getBillingProvider(name: ProviderName): BillingProvider {
  let provider = instances.get(name);
  if (!provider) {
    switch (name) {
      case "mock":
        provider = new MockBillingProvider();
        break;
      case "factuplan":
        provider = new FactuplanProvider();
        break;
      default: {
        const exhaustive: never = name;
        throw new Error(`Proveedor desconocido: ${String(exhaustive)}`);
      }
    }
    instances.set(name, provider);
  }
  return provider;
}
