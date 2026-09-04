import { useState } from "react";
import type { PlantaImportada, Projeto } from "@croqui/shared";
import { ProjetoView } from "./components/ProjetoView";
import { UploadView } from "./components/UploadView";
import { QuestionarioView } from "./components/QuestionarioView";
import { EditorView } from "./components/EditorView";
import "./App.css";

type Etapa =
  | { nome: "projeto" }
  | { nome: "upload"; projeto: Projeto }
  | { nome: "questionario"; projeto: Projeto; planta: PlantaImportada }
  | { nome: "editor"; projeto: Projeto; planta: PlantaImportada };

export default function App() {
  const [etapa, setEtapa] = useState<Etapa>({ nome: "projeto" });

  switch (etapa.nome) {
    case "projeto":
      return <ProjetoView onSelecionar={(projeto) => setEtapa({ nome: "upload", projeto })} />;

    case "upload":
      return (
        <UploadView
          projeto={etapa.projeto}
          onImportada={(planta) => setEtapa({ nome: "questionario", projeto: etapa.projeto, planta })}
        />
      );

    case "questionario":
      return (
        <QuestionarioView
          projeto={etapa.projeto}
          onConcluido={() => setEtapa({ nome: "editor", projeto: etapa.projeto, planta: etapa.planta })}
        />
      );

    case "editor":
      return (
        <EditorView
          projeto={etapa.projeto}
          plantaInicial={etapa.planta}
          onVoltar={() => setEtapa({ nome: "projeto" })}
        />
      );
  }
}
