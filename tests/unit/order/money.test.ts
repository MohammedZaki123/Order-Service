import { toMinor, fromMinor, sumMinor, multiplyMinor } from "../../../src/pkg/utils/money";

describe("Money Utilities Unit Tests (AAA)", () => {
    describe("toMinor", () => {
        it("should convert major units to minor units correctly", () => {
            // Arrange
            const majorUnits = 10.50;

            // Act
            const result = toMinor(majorUnits);

            // Assert
            expect(result).toBe(1050);
        });
    });

    describe("fromMinor", () => {
        it("should convert minor units to major units correctly", () => {
            // Arrange
            const minorUnits = 1050;

            // Act
            const result = fromMinor(minorUnits);

            // Assert
            expect(result).toBe(10.50);
        });
    });

    describe("sumMinor", () => {
        it("should calculate the sum of an array of minor units", () => {
            // Arrange
            const values = [100, 250, 300];

            // Act
            const result = sumMinor(values);

            // Assert
            expect(result).toBe(650);
        });
    });

    describe("multiplyMinor", () => {
        it("should multiply minor units price by quantity correctly", () => {
            // Arrange
            const unitPrice = 150;
            const quantity = 3;

            // Act
            const result = multiplyMinor(unitPrice, quantity);

            // Assert
            expect(result).toBe(450);
        });
    });
});
