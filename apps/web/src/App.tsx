import { useState } from "react";
import type { PlantaImportada, Projeto } from "@croqui/shared";
import { ProjetoView } from "./components/ProjetoView";
import { UploadView } from "./components/UploadView";
import { QuestionarioView } from "./components/QuestionarioView";
import { PlantaViewer } from "./components/PlantaViewer";
import "./App.css";

type Etapa =
  | { nome: "projeto" }
  | { nome: "upload"; projeto: Projeto }
  | { nome: "questionario"; projeto: Projeto; planta: PlantaImportada }
  | { nome: "viewer"; projeto: Projeto; planta: PlantaImportada };

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
          onConcluido={() => setEtapa({ nome: "viewer", projeto: etapa.projeto, planta: etapa.planta })}
        />
      );

    case "viewer":
      return <PlantaViewer planta={etapa.planta} onVoltar={() => setEtapa({ nome: "projeto" })} />;
  }
}
