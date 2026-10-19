import pytest

from qgdevs import matlab_bridge, bmv


@pytest.mark.skipif(not matlab_bridge.available()["available"], reason="no MATLAB engine or GNU Octave installed")
@pytest.mark.parametrize("geometry", ["parallel", "linear"])
def test_matlab_matches_python(geometry):
    d = bmv.BMVDesign(geometry=geometry)
    py = bmv.entangling_phase(bmv.phases_from_energies(bmv.gravitational_branch_energies(d, False), d.time))
    ml = matlab_bridge.bmv_entangling_phase(d.mass_A, d.mass_B, d.separation, d.dx_A, d.time, geometry)
    assert ml == pytest.approx(py, rel=1e-12)


def test_reports_availability_honestly():
    a = matlab_bridge.available()
    assert a["available"] == (a["backend"] is not None)
