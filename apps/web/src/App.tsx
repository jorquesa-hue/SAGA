import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { Alerts } from "./pages/Alerts.js";
import { Assets } from "./pages/Assets.js";
import { Genetics } from "./pages/Genetics.js";
import { Inventory } from "./pages/Inventory.js";
import { Pasture } from "./pages/Pasture.js";
import { Tasks } from "./pages/Tasks.js";
import { AnimalDetail } from "./pages/AnimalDetail.js";
import { TraceabilityRecord } from "./pages/TraceabilityRecord.js";
import { Animals } from "./pages/Animals.js";
import { Budgets } from "./pages/Budgets.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Exports } from "./pages/Exports.js";
import { Finance } from "./pages/Finance.js";
import { Imports } from "./pages/Imports.js";
import { Integrations } from "./pages/Integrations.js";
import { Lots } from "./pages/Lots.js";
import { LotDetail } from "./pages/LotDetail.js";
import { Recommendations } from "./pages/Recommendations.js";
import { Reports } from "./pages/Reports.js";
import { Reproduction } from "./pages/Reproduction.js";
import { SearchResults } from "./pages/SearchResults.js";
import { Settings } from "./pages/Settings.js";
import { SignIn } from "./pages/SignIn.js";
import { Treatments } from "./pages/Treatments.js";
import { Weighing } from "./pages/Weighing.js";
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
        <Route path="search" element={<SearchResults />} />
        <Route path="animals" element={<Animals />} />
        <Route path="animals/:id" element={<AnimalDetail />} />
        <Route path="animals/:id/record" element={<TraceabilityRecord />} />
        <Route path="weighing" element={<Weighing />} />
        <Route path="treatments" element={<Treatments />} />
        <Route path="reproduction" element={<Reproduction />} />
        <Route path="lots" element={<Lots />} />
        <Route path="lots/:id" element={<LotDetail />} />
        <Route path="pasture" element={<Pasture />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="assets" element={<Assets />} />
        <Route path="genetics" element={<Genetics />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="finance" element={<Finance />} />
        <Route path="budgets" element={<Budgets />} />
        <Route path="imports" element={<Imports />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="recommendations" element={<Recommendations />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="reports" element={<Reports />} />
        <Route path="exports" element={<Exports />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
