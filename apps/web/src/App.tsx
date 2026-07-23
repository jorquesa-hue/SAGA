import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { Alerts } from "./pages/Alerts.js";
import { AnimalDetail } from "./pages/AnimalDetail.js";
import { Animals } from "./pages/Animals.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Exports } from "./pages/Exports.js";
import { Integrations } from "./pages/Integrations.js";
import { Recommendations } from "./pages/Recommendations.js";
import { SignIn } from "./pages/SignIn.js";
import { useSession } from "./session.js";

export function App(): JSX.Element {
  const { session } = useSession();

  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<SignIn />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="animals" element={<Animals />} />
        <Route path="animals/:id" element={<AnimalDetail />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="recommendations" element={<Recommendations />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="exports" element={<Exports />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
