import type { PlantaImportada, Projeto, QuestionarioProjeto, ServiceCategory } from "@croqui/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3333";

async function tratarResposta<T>(res: Response, mensagemPadrao: string): Promise<T> {
  if (!res.ok) {
    const corpo = await res.json().catch(() => null);
    throw new Error(corpo?.erro ?? mensagemPadrao);
  }
  return res.json();
}

export async function criarProjeto(nomeCliente: string): Promise<Projeto> {
  const res = await fetch(`${API_URL}/projetos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nomeCliente }),
  });
  return tratarResposta(res, "Falha ao criar o projeto.");
}

export async function listarProjetos(): Promise<Projeto[]> {
  const res = await fetch(`${API_URL}/projetos`);
  return tratarResposta(res, "Falha ao listar projetos.");
}

export async function enviarPlanta(projetoId: string, arquivo: File): Promise<PlantaImportada> {
  const formData = new FormData();
  formData.append("projetoId", projetoId);
  formData.append("arquivo", arquivo);

  const res = await fetch(`${API_URL}/plantas`, { method: "POST", body: formData });
  return tratarResposta(res, "Falha ao enviar o arquivo.");
}

export async function listarPlantasDoProjeto(projetoId: string): Promise<PlantaImportada[]> {
  const res = await fetch(`${API_URL}/projetos/${projetoId}/plantas`);
  return tratarResposta(res, "Falha ao listar plantas do projeto.");
}

export function urlArquivoPlanta(id: string): string {
  return `${API_URL}/plantas/${id}/arquivo`;
}

export async function salvarQuestionario(
  projetoId: string,
  servicos: ServiceCategory[],
  observacoes: string
): Promise<QuestionarioProjeto> {
  const res = await fetch(`${API_URL}/projetos/${projetoId}/questionario`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ servicos, observacoes: observacoes || undefined }),
  });
  return tratarResposta(res, "Falha ao salvar o questionário.");
}
