import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { signOut } from "./auth";
import { useIsPhone } from "./lib/useMedia";
import { Link, navigate } from "./router";
import { useSession } from "./session";
import type { ShowView } from "./types";
import { Avatar, Icon, type IconName } from "./ui";

export function Wordmark(props: { to?: string }) {
  return (
    <Link to={props.to ?? "/"} className="wordmark" aria-label="Worklight home">
      <img src="/brand/worklight-mark-small.svg" alt="" />
      Worklight
    </Link>
  );
}

/** Avatar with the account menu: company pages, my conflicts, sign out. */
export function AccountMenu(props: { showId?: string; isStaff?: boolean }) {
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const theater = me.theaters[0]?.theater;
  const activeShows = me.shows.filter((s) => s.show.status === "active");
  return (
    <div className="menu" ref={ref}>
      <button className="avatar" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Avatar name={me.user.name} email={me.user.email} />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <div className="menu-head">
            <div style={{ fontWeight: 700 }}>{me.user.name ?? me.user.email}</div>
            <div className="small muted">{me.user.email}</div>
          </div>
          {theater && <Link to={`/c/${theater.theaterId}`}>Company home</Link>}
          {theater && <Link to={`/c/${theater.theaterId}/staff`}>Staff and admins</Link>}
          {activeShows.length > 1 && <Link to="/shows">All my shows</Link>}
          {props.showId && props.isStaff && <Link to={`/shows/${props.showId}/settings`}>Show settings</Link>}
          {props.showId && <Link to={`/shows/${props.showId}/conflicts`}>My conflicts</Link>}
          <Link to="/account">Account and notifications</Link>
          <button
            onClick={() => {
              signOut();
              navigate("/", true);
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Top bar for company pages (home, staff, setup). */
export function CompanyShell(props: { context?: string; children: ReactNode }) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Wordmark />
          {props.context && <span className="topbar-context">{props.context}</span>}
          <span className="topbar-spacer" />
          <AccountMenu />
        </div>
      </header>
      {props.children}
    </>
  );
}

export type StaffTab = "schedule" | "breakdown" | "people" | "tech" | "callboard" | "settings";

interface Tab {
  id: StaffTab;
  label: string;
  icon: IconName;
  path: string;
}

/** Tabs that exist so far. Tech shows from 7 days before tech week through closing. */
export function staffTabs(view: ShowView): Tab[] {
  const id = view.show.showId;
  const tabs: Tab[] = [
    { id: "schedule", label: "Schedule", icon: "calendar", path: `/shows/${id}/schedule` },
    { id: "breakdown", label: "Breakdown", icon: "lines", path: `/shows/${id}/breakdown` },
    { id: "people", label: "People", icon: "people", path: `/shows/${id}/people` },
  ];
  tabs.push({ id: "callboard", label: "Callboard", icon: "megaphone", path: `/shows/${id}/callboard` });
  if (view.show.techStart) tabs.push({ id: "tech", label: "Tech week", icon: "target", path: `/shows/${id}/tech` });
  return tabs;
}

/** Director and staff pages: top nav on web, top bar plus bottom tabs on phone. */
export function StaffShell(props: { view: ShowView; current: StaffTab; children: ReactNode }) {
  const phone = useIsPhone();
  const tabs = staffTabs(props.view);
  const archived = props.view.show.status === "archived";
  const banner = archived ? (
    <div className="archived-bar">This show is archived. Everything is read-only.</div>
  ) : null;
  if (phone) {
    return (
      <div className="has-tabs">
        <header className="phone-top">
          <Wordmark />
          <span className="topbar-context">{props.view.show.name}</span>
          <AccountMenu showId={props.view.show.showId} isStaff />
        </header>
        {banner}
        {props.children}
        <nav className="tabs" aria-label="Show">
          {tabs.map((t) => (
            <Link key={t.id} to={t.path} current={t.id === props.current}>
              <Icon name={t.icon} />
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
    );
  }
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Wordmark />
          <span className="topbar-context">{props.view.show.name}</span>
          <nav className="topnav" aria-label="Show">
            {tabs.map((t) => (
              <Link key={t.id} to={t.path} current={t.id === props.current}>
                {t.label}
              </Link>
            ))}
          </nav>
          <AccountMenu showId={props.view.show.showId} isStaff />
        </div>
      </header>
      {banner}
      {props.children}
    </>
  );
}

export type ActorTab = "calls" | "conflicts" | "show";

/** Actor pages are phone-first: centered at 480px on a laptop, bottom tabs always. */
export function ActorShell(props: { showId: string; current: ActorTab; children: ReactNode; archived?: boolean }) {
  const base = `/shows/${props.showId}`;
  const tabs: { id: ActorTab; label: string; icon: IconName; path: string }[] = [
    { id: "calls", label: "My calls", icon: "clock", path: `${base}/calls` },
    { id: "conflicts", label: "Conflicts", icon: "calendar", path: `${base}/conflicts` },
    { id: "show", label: "Show", icon: "megaphone", path: base },
  ];
  // Unread callboard notices, as a count on the Show tab (the Show page itself lists them).
  const [unread, setUnread] = useState(0);
  const away = props.current !== "show";
  useEffect(() => {
    if (!away) return setUnread(0);
    let live = true;
    api
      .callboard(props.showId)
      .then((b) => live && setUnread(b.unread))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [props.showId, away]);
  return (
    <div className="phone-page has-tabs">
      {props.archived && <div className="archived-bar">This show is archived. You can still look back at it.</div>}
      {props.children}
      <nav className="tabs" aria-label="Main">
        {tabs.map((t) => (
          <Link key={t.id} to={t.path} current={t.id === props.current}>
            <span className="tab-icon">
              <Icon name={t.icon} />
              {t.id === "show" && unread > 0 && (
                <span className="tab-badge" aria-label={`${unread} new`}>
                  {unread}
                </span>
              )}
            </span>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
