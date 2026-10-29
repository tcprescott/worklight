from call_time.roles import can_on_show, can_on_theater


def test_staff_run_the_show_and_cast_only_their_own_conflicts() -> None:
    assert can_on_show("staff", "schedule:edit")
    assert can_on_show("staff", "conflicts:read-all")
    assert can_on_show("cast", "conflicts:edit-own")
    assert not can_on_show("cast", "schedule:edit")
    assert not can_on_show("crew", "members:invite")
    assert not can_on_show(None, "show:read")


def test_theater_admins_create_shows() -> None:
    assert can_on_theater("admin", "shows:create")
    assert not can_on_theater(None, "shows:create")
