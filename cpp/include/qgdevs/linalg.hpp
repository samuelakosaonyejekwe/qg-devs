// Hermitian eigenproblem by the cyclic complex Jacobi method and derived matrix functions.
#pragma once

#include <vector>

#include "qgdevs/matrix.hpp"

namespace qgdevs {

// Eigenvalues (ascending) and optionally eigenvectors (columns of *V) of a Hermitian matrix.
// Only the Hermitian part ½(A + A†) is used. Each rotation is the unitary
// J = diag(1, e^{-iφ}) R(c, s) that zeroes a_pq = |a_pq| e^{iφ} (Rutishauser 1966; Golub & Van Loan §8.5).
void eigh(const CMat& A, std::vector<double>& w, CMat* V = nullptr);
std::vector<double> eigvalsh(const CMat& A);

// Singular values (descending) by the one-sided Hestenes–Jacobi method: columns are orthogonalised
// pairwise with the rotation that diagonalises their 2×2 Gram matrix; σ_k are the final column norms.
// Small σ carry absolute error O(ε‖A‖) (no squaring as in eig(A†A)) (Demmel & Veselić 1992).
std::vector<double> singular_values(const CMat& A);

// f(A) = V diag(f(w)) V† for Hermitian A with f(w) = sqrt(max(w, 0)).
CMat sqrtm_psd(const CMat& A);

}  // namespace qgdevs
