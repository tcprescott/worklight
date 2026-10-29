import { useEffect } from "react";
import { api } from "./api";
import { isSignedIn } from "./auth";
import { Account } from "./pages/Account";
import { GuidedSetup } from "./pages/actor/GuidedSetup";
import { Join } from "./pages/actor/Join";
import { MyCalls } from "./pages/actor/MyCalls";
import { MyConflicts } from "./pages/actor/MyConflicts";
import { ShowHome } from "./pages/actor/ShowHome";
import { AuthCallback } from "./pages/AuthCallback";
import { Breakdown } from "./pages/director/Breakdown";
import { CompanyHome } from "./pages/director/CompanyHome";
import { People } from "./pages/director/People";
import { Schedule } from "./pages/director/Schedule";
import { TechWeek } from "./pages/director/TechWeek";
import { StageDoor } from "./pages/actor/StageDoor";
import { SetupWizard } from "./pages/director/SetupWizard";
import { ShowSettings } from "./pages/director/ShowSettings";
import { Staff } from "./pages/director/Staff";
import { MagicLink } from "./pages/MagicLink";
import { MyShows } from "./pages/MyShows";
import { SignIn } from "./pages/SignIn";
import { canOnShow } from "./roles";
import { match, navigate, useLocation } from "./router";
import { SessionProvider, useSession } from "./session";
import type { ShowView } from "./types";
import { ErrorView, Loading } from "./ui";
import { useAsync } from "./useAsync";

export function App() {
  const { path, search } = useLocation();

  // Public routes: finishing a sign-in, and invite links (which sign you in themselves).
  if (path === "/auth/magic") return <MagicLink />;
  if (path === "/auth/callback") return <AuthCallback />;
  const join = match("/join/{token}", path);
  if (join) return <Join token={join.token!} />;
  if (!isSignedIn()) return <SignIn next={path === "/sign-in" ? "/" : path + search} />;

  return (
    <SessionProvider>
      {({ loading, error }) =>
        error ? <ErrorView message={error} onRetry={() => location.reload()} /> : loading ? <Loading /> : <SignedIn path={path} />
      }
    </SessionProvider>
  );
}

function SignedIn(props: { path: string }) {
  const { path } = props;
  if (path === "/" || path === "/sign-in") return <Home />;
  if (path === "/shows") return <MyShows />;
  if (path === "/account") return <Account />;
  if (path === "/setup") return <SetupWizard />;

  let m = match("/c/{theaterId}", path);
  if (m) return <CompanyHome theaterId={m.theaterId!} />;
  m = match("/c/{theaterId}/staff", path);
  if (m) return <Staff theaterId={m.theaterId!} />;
  m = match("/c/{theaterId}/new-show", path);
  if (m) return <SetupWizard theaterId={m.theaterId!} />;

  m = match("/shows/{showId}/{page}", path) ?? match("/shows/{showId}/{page}/{sub}", path) ?? match("/shows/{showId}", path);
  if (m) return <ShowRoute key={m.showId} showId={m.showId!} page={m.page ?? ""} sub={m.sub} />;

  return <ErrorView message="That page doesn't exist." />;
}

/** "/" sends people where they work: company home for admins, their show for everyone else. */
function Home() {
  const { me } = useSession();
  useEffect(() => {
    const theater = me.theaters[0];
    const active = me.shows.filter((s) => s.show.status === "active");
    if (theater) navigate(`/c/${theater.theater.theaterId}`, true);
    else if (active.length === 1) navigate(`/shows/${active[0]!.show.showId}`, true);
    else navigate("/shows", true);
  }, [me]);
  return <Loading />;
}

export interface ShowPageProps {
  view: ShowView;
  reloadView: () => Promise<void>;
  sub?: string;
}

function ShowRoute(props: { showId: string; page: string; sub?: string }) {
  const { data: view, error, reload } = useAsync(() => api.show(props.showId), [props.showId]);
  if (error) return <ErrorView message={error} />;
  if (!view) return <Loading />;
  const pageProps: ShowPageProps = { view, reloadView: async () => void (await reload()), sub: props.sub };
  const staff = canOnShow(view.role, "schedule:edit");

  switch (props.page) {
    case "":
      // Staff land on their working page; cast and crew land on the show page.
      if (staff) {
        navigate(`/shows/${props.showId}/schedule`, true);
        return <Loading />;
      }
      return <ShowHome {...pageProps} />;
    case "setup":
      return <GuidedSetup {...pageProps} />;
    case "conflicts":
      return <MyConflicts {...pageProps} />;
    case "calls":
      return <MyCalls {...pageProps} />;
    case "schedule":
      return staff ? <Schedule {...pageProps} /> : <NotForYou />;
    case "tech":
      return staff ? <TechWeek {...pageProps} /> : <NotForYou />;
    case "door":
      // Scanned from the stage door sign: /shows/:id/door?code=...
      return <StageDoor {...pageProps} />;
    case "breakdown":
      return staff ? <Breakdown {...pageProps} /> : <NotForYou />;
    case "people":
      return staff ? <People {...pageProps} /> : <NotForYou />;
    case "settings":
      return staff ? <ShowSettings {...pageProps} /> : <NotForYou />;
    default:
      return <ErrorView message="That page doesn't exist." />;
  }
}

function NotForYou() {
  return <ErrorView message="Only show staff can open this page." />;
}
