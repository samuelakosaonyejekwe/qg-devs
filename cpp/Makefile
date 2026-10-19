# libqgdevs_native: C++17 numerical kernel for QG-DEVS (Suite 15). No external dependencies.
#   make          -> build/libqgdevs_native.so
#   make test     -> build and run the standalone analytic test executable
#   make clean

CXX      ?= g++
CXXFLAGS ?= -O3 -march=x86-64-v2
# -fcx-limited-range: textbook complex multiply instead of the Annex-G __muldc3 call (inf/NaN recovery).
# All operands in the kernel are finite and complex divisions are only by real magnitudes.
CXXFLAGS += -std=c++17 -fopenmp -fPIC -fcx-limited-range -Wall -Wextra -Iinclude
LDFLAGS  += -fopenmp

BUILD := build
SRCS  := src/matrix.cpp src/linalg.cpp src/lindblad.cpp src/bmv.cpp src/nbody.cpp src/capi.cpp
OBJS  := $(SRCS:src/%.cpp=$(BUILD)/%.o)
HDRS  := $(wildcard include/qgdevs/*.hpp include/qgdevs/*.h)
LIB   := $(BUILD)/libqgdevs_native.so
TEST  := $(BUILD)/test_native

.PHONY: all test clean

all: $(LIB)

$(BUILD):
	mkdir -p $(BUILD)

$(BUILD)/%.o: src/%.cpp $(HDRS) | $(BUILD)
	$(CXX) $(CXXFLAGS) -c $< -o $@

$(LIB): $(OBJS)
	$(CXX) -shared $(OBJS) -o $@ $(LDFLAGS)

$(TEST): tests/test_native.cpp $(OBJS)
	$(CXX) $(CXXFLAGS) $< $(OBJS) -o $@ $(LDFLAGS)

test: $(TEST)
	./$(TEST)

clean:
	rm -rf $(BUILD)
