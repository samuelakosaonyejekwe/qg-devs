#include "qgdevs/matrix.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace qgdevs {

CMat CMat::identity(int n) {
    CMat I(n, n);
    for (int i = 0; i < n; ++i) I(i, i) = 1.0;
    return I;
}

CMat CMat::from_data(int rows, int cols, const cplx* src) {
    CMat M(rows, cols);
    std::copy(src, src + M.size(), M.data());
    return M;
}

CMat CMat::adjoint() const {
    CMat B(c_, r_);
    for (int i = 0; i < r_; ++i)
        for (int j = 0; j < c_; ++j) B(j, i) = std::conj((*this)(i, j));
    return B;
}

CMat CMat::conjugate() const {
    CMat B(r_, c_);
    for (std::size_t k = 0; k < a_.size(); ++k) B.a_[k] = std::conj(a_[k]);
    return B;
}

cplx CMat::trace() const {
    cplx s = 0.0;
    for (int i = 0; i < std::min(r_, c_); ++i) s += (*this)(i, i);
    return s;
}

void CMat::set_zero() { std::fill(a_.begin(), a_.end(), cplx(0.0)); }

CMat& CMat::operator+=(const CMat& o) {
    if (o.r_ != r_ || o.c_ != c_) throw std::invalid_argument("CMat +=: shape mismatch");
    for (std::size_t k = 0; k < a_.size(); ++k) a_[k] += o.a_[k];
    return *this;
}

CMat& CMat::operator-=(const CMat& o) {
    if (o.r_ != r_ || o.c_ != c_) throw std::invalid_argument("CMat -=: shape mismatch");
    for (std::size_t k = 0; k < a_.size(); ++k) a_[k] -= o.a_[k];
    return *this;
}

CMat& CMat::operator*=(cplx s) {
    for (auto& v : a_) v *= s;
    return *this;
}

void matmul(const CMat& A, const CMat& B, CMat& C) {
    if (A.cols() != B.rows() || C.rows() != A.rows() || C.cols() != B.cols())
        throw std::invalid_argument("matmul: shape mismatch");
    const int n = A.rows(), m = A.cols(), p = B.cols();
    C.set_zero();
    for (int i = 0; i < n; ++i)
        for (int k = 0; k < m; ++k) {
            const cplx a = A(i, k);
            if (a == cplx(0.0)) continue;
            const cplx* brow = &B(k, 0);
            cplx* crow = &C(i, 0);
            for (int j = 0; j < p; ++j) crow[j] += a * brow[j];
        }
}

void matmul_adj(const CMat& A, const CMat& B, CMat& C) {
    if (A.cols() != B.cols() || C.rows() != A.rows() || C.cols() != B.rows())
        throw std::invalid_argument("matmul_adj: shape mismatch");
    const int n = A.rows(), m = A.cols(), p = B.rows();
    for (int i = 0; i < n; ++i)
        for (int j = 0; j < p; ++j) {
            cplx s = 0.0;
            const cplx* arow = &A(i, 0);
            const cplx* brow = &B(j, 0);
            for (int k = 0; k < m; ++k) s += arow[k] * std::conj(brow[k]);
            C(i, j) = s;
        }
}

CMat operator*(const CMat& A, const CMat& B) {
    CMat C(A.rows(), B.cols());
    matmul(A, B, C);
    return C;
}
CMat operator+(CMat A, const CMat& B) { return A += B; }
CMat operator-(CMat A, const CMat& B) { return A -= B; }
CMat operator*(cplx s, CMat A) { return A *= s; }

CMat kron(const CMat& A, const CMat& B) {
    CMat K(A.rows() * B.rows(), A.cols() * B.cols());
    for (int i = 0; i < A.rows(); ++i)
        for (int j = 0; j < A.cols(); ++j)
            for (int k = 0; k < B.rows(); ++k)
                for (int l = 0; l < B.cols(); ++l) K(i * B.rows() + k, j * B.cols() + l) = A(i, j) * B(k, l);
    return K;
}

double max_abs_diff(const CMat& A, const CMat& B) {
    double m = 0.0;
    for (std::size_t k = 0; k < A.size(); ++k) m = std::max(m, std::abs(A.data()[k] - B.data()[k]));
    return m;
}

double hermiticity_error(const CMat& A) {
    double m = 0.0;
    for (int i = 0; i < A.rows(); ++i)
        for (int j = 0; j < A.cols(); ++j) m = std::max(m, std::abs(A(i, j) - std::conj(A(j, i))));
    return m;
}

}  // namespace qgdevs
