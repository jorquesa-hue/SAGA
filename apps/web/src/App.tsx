import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { Animals } from "./pages/Animals.js";
import { Dashboard } from "./pages/Dashboard.js";
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
        <Route path="recommendations" element={<Recommendations />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
