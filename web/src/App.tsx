import { isSignedIn, signOut } from "./auth";
import { AuthCallback } from "./pages/AuthCallback";
import { Home } from "./pages/Home";
import { InviteAccept } from "./pages/InviteAccept";
import { MagicLink } from "./pages/MagicLink";
import { ShowPage } from "./pages/ShowPage";
import { SignIn } from "./pages/SignIn";
import { Link, match, navigate, useLocation } from "./router";

export function App() {
  const { path } = useLocation();

  // Public routes: finishing a sign-in.
  if (path === "/auth/magic") return <MagicLink />;
  if (path === "/auth/callback") return <AuthCallback />;

  const invite = match("/invite/{token}", path);
  if (!isSignedIn()) return <SignIn next={path} heading={invite ? "Sign in to join the show" : undefined} />;

  const show = match("/shows/{showId}", path);
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          Worklight
        </Link>
        <button
          className="link"
          onClick={() => {
            signOut();
            navigate("/", true);
          }}
        >
          Sign out
        </button>
      </header>
      <main className="page">
        {invite ? <InviteAccept token={invite.token!} /> : show ? <ShowPage showId={show.showId!} /> : <Home />}
      </main>
    </>
  );
}
