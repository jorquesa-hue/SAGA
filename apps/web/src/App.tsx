import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { Alerts } from "./pages/Alerts.js";
import { AnimalDetail } from "./pages/AnimalDetail.js";
import { Animals } from "./pages/Animals.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Exports } from "./pages/Exports.js";
import { Finance } from "./pages/Finance.js";
import { Integrations } from "./pages/Integrations.js";
import { Lots } from "./pages/Lots.js";
import { Recommendations } from "./pages/Recommendations.js";
import { Reproduction } from "./pages/Reproduction.js";
import { SearchResults } from "./pages/SearchResults.js";
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
        <Route path="weighing" element={<Weighing />} />
        <Route path="treatments" element={<Treatments />} />
        <Route path="reproduction" element={<Reproduction />} />
        <Route path="lots" element={<Lots />} />
        <Route path="finance" element={<Finance />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="recommendations" element={<Recommendations />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="exports" element={<Exports />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
