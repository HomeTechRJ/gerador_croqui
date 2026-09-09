import { useEffect, useState } from "react";
import type { PlantaImportada, Projeto } from "@croqui/shared";
import { ProjetoView } from "./components/ProjetoView";
import { UploadView } from "./components/UploadView";
import { QuestionarioView } from "./components/QuestionarioView";
import { EditorView } from "./components/EditorView";
import type { PontoLocal } from "./components/EditorView";
import { listarPlantasDoProjeto } from "./api";
import {
  limparSessaoEditor,
  salvarSessaoEditor,
} from "./lib/sessaoEditor";
import "./App.css";

type Etapa =
  | { nome: "projeto" }
  | { nome: "upload"; projeto: Projeto }
  | { nome: "questionario"; projeto: Projeto; planta: PlantaImportada; ambienteInicial?: { posX: number; posY: number; nome?: string }; pontosIniciais?: PontoLocal[] }
  | { nome: "editor"; projeto: Projeto; planta: PlantaImportada; pontosIniciais?: PontoLocal[] };

export default function App() {
  const [etapa, setEtapa] = useState<Etapa>({ nome: "projeto" });

  async function abrirProjeto(projeto: Projeto) {
    try {
      const plantas = await listarPlantasDoProjeto(projeto.id);
      const ultimaPlantaPronta = [...plantas]
        .reverse()
        .find((item) => item.status === "pronta" && item.formatoExibicao);
      setEtapa(ultimaPlantaPronta
        ? { nome: "editor", projeto, planta: ultimaPlantaPronta }
        : { nome: "upload", projeto });
    } catch {
      setEtapa({ nome: "upload", projeto });
    }
  }


  useEffect(() => {
    if (!etapa) return;

    if (etapa.nome === "projeto") {
      limparSessaoEditor();
    } else if (etapa.nome === "upload") {
      salvarSessaoEditor({ etapa: "upload", projetoId: etapa.projeto.id });
    } else if (etapa.nome === "questionario") {
      salvarSessaoEditor({
        etapa: "questionario",
        projetoId: etapa.projeto.id,
        plantaId: etapa.planta.id,
      });
    } else {
      salvarSessaoEditor({
        etapa: "editor",
        projetoId: etapa.projeto.id,
        plantaId: etapa.planta.id,
      });
    }
  }, [etapa]);

  if (!etapa) {
    return (
      <main className="upload-view">
        <p>Restaurando o último croqui…</p>
      </main>
    );
  }

  switch (etapa.nome) {
    case "projeto":
      return <ProjetoView onSelecionar={abrirProjeto} />;

    case "upload":
      return (
        <UploadView
          projeto={etapa.projeto}
          onImportada={(planta) => setEtapa({ nome: "editor", projeto: etapa.projeto, planta })}
        />
      );

    case "questionario":
      return (
        <QuestionarioView
          projeto={etapa.projeto}
          planta={etapa.planta}
          ambienteInicial={etapa.ambienteInicial}
          onVoltar={() => setEtapa({ nome: "editor", projeto: etapa.projeto, planta: etapa.planta, pontosIniciais: etapa.pontosIniciais })}
          onConcluido={() => setEtapa({ nome: "editor", projeto: etapa.projeto, planta: etapa.planta, pontosIniciais: etapa.pontosIniciais })}
        />
      );

    case "editor":
      return (
        <EditorView
          projeto={etapa.projeto}
          plantaInicial={etapa.planta}
          pontosIniciais={etapa.pontosIniciais}
          onVoltar={() => setEtapa({ nome: "projeto" })}
          onPlantaAtivaChange={(plantaId) => {
            salvarSessaoEditor({
              etapa: "editor",
              projetoId: etapa.projeto.id,
              plantaId,
            });
          }}
          onSemPlantas={() => setEtapa({ nome: "projeto" })}
          onEditarBriefing={(planta, ambienteInicial, pontosAtuais) => setEtapa({
            nome: "questionario",
            projeto: etapa.projeto,
            planta,
            ambienteInicial,
            pontosIniciais: pontosAtuais,
          })}
        />
      );
  }
}
