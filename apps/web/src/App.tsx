import { useState } from "react";
import type { PlantaImportada } from "@croqui/shared";
import { UploadView } from "./components/UploadView";
import { PlantaViewer } from "./components/PlantaViewer";
import "./App.css";

export default function App() {
  const [planta, setPlanta] = useState<PlantaImportada | null>(null);

  return planta ? (
    <PlantaViewer planta={planta} onVoltar={() => setPlanta(null)} />
  ) : (
    <UploadView onImportada={setPlanta} />
  );
}
