class Solution:
    def minOperations(self, nums: List[int], x: int, y: int) -> int:
        # Binary search on the number of operations
        def canMakeNonPositive(k):
            # After k operations, each element is decreased by at least k * y
            # For each element nums[i], if nums[i] > k * y, we need to target it
            # some additional times to reduce it further
            remaining = []
            for num in nums:
                if num > k * y:
                    # Need to reduce by (num - k * y) more
                    # Each targeted operation reduces by (x - y) extra
                    need = (num - k * y + x - y - 1) // (x - y)  # Ceiling division
                    remaining.append(need)
            
            # We have k operations total, can we cover all remaining?
            return sum(remaining) <= k
        
        # Binary search for minimum k
        left, right = 0, max(nums) // y + 1
        result = right
        
        while left <= right:
            mid = (left + right) // 2
            if canMakeNonPositive(mid):
                result = mid
                right = mid - 1
            else:
                left = mid + 1
        
        return result

