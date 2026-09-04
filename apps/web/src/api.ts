import type { PlantaImportada } from "@croqui/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3333";

export async function enviarPlanta(arquivo: File): Promise<PlantaImportada> {
  const formData = new FormData();
  formData.append("arquivo", arquivo);

  const res = await fetch(`${API_URL}/plantas`, { method: "POST", body: formData });
  if (!res.ok) {
    const corpo = await res.json().catch(() => null);
    throw new Error(corpo?.erro ?? "Falha ao enviar o arquivo.");
  }
  return res.json();
}

export function urlArquivoPlanta(id: string): string {
  return `${API_URL}/plantas/${id}/arquivo`;
}
