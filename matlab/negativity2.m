function N = negativity2(rho)
%NEGATIVITY2  Negativity of a two-qubit state: sum of |negative eigenvalues| of the partial transpose on B.
R = reshape(rho, [2 2 2 2]);      % column-major: R(b, a, b', a') for basis index a*2+b
PT = permute(R, [3 2 1 4]);        % transpose subsystem B
ev = eig((reshape(PT, 4, 4) + reshape(PT, 4, 4)')/2);
N = -sum(ev(ev < 0));
end
