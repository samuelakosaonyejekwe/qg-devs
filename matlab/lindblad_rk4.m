function rho = lindblad_rk4(rho0, H, Ls, T, N)
%LINDBLAD_RK4  Fixed-step RK4 integration of d rho/dt = -i[H,rho] + sum_k (L rho L' - 1/2{L'L, rho}).
%   H is H/hbar in rad/s; Ls is a cell array of Lindblad operators. Mirrors qgdevs.quantum.
dt = T / N; rho = rho0;
f = @(r) lindblad_rhs(r, H, Ls);
for n = 1:N
  k1 = f(rho); k2 = f(rho + dt/2*k1); k3 = f(rho + dt/2*k2); k4 = f(rho + dt*k3);
  rho = rho + dt/6*(k1 + 2*k2 + 2*k3 + k4);
end
end

function out = lindblad_rhs(r, H, Ls)
out = -1i*(H*r - r*H);
for k = 1:numel(Ls)
  L = Ls{k}; LdL = L'*L;
  out = out + L*r*L' - 0.5*(LdL*r + r*LdL);
end
end
