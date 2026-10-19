function [dphi, phases] = bmv_entangling_phase(mA, mB, d, dx, t, geometry)
%BMV_ENTANGLING_PHASE  Branch phases and entangling phase for two superposed point masses.
%   phi_ij = G mA mB t / (hbar r_ij);  dphi = phi_LL + phi_RR - phi_LR - phi_RL.
%   geometry: 'parallel' (split axis perpendicular to the A-B line) or 'linear'.
%   CODATA 2022 constants; mirrors qgdevs.bmv for independent cross-checks.
G = 6.67430e-11; hbar = 1.054571817e-34;
if strcmp(geometry, 'linear'), n = [1 0 0]; else, n = [0 1 0]; end
A = [0.5*dx*n; -0.5*dx*n];
B = [[d 0 0] + 0.5*dx*n; [d 0 0] - 0.5*dx*n];
phases = zeros(2, 2);
for i = 1:2
  for j = 1:2
    phases(i, j) = G*mA*mB*t / (hbar*norm(A(i,:) - B(j,:)));
  end
end
dphi = phases(1,1) + phases(2,2) - phases(1,2) - phases(2,1);
end
