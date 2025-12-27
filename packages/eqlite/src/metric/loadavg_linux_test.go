

package metric

import "testing"

func TestLoad(t *testing.T) {
	want := []float64{0.21, 0.37, 0.39}
	loads, err := parseLoad("0.21 0.37 0.39 1/719 19737")
	if err != nil {
		t.Fatal(err)
	}

	for i, load := range loads {
		if want[i] != load {
			t.Fatalf("want load %f, got %f", want[i], load)
		}
	}
}
