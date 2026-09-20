package com.devkit.model;

import java.math.BigDecimal;
import java.util.List;
import lombok.Data;

@Data
public class Order {
    private Long id;
    private String name;
    private BigDecimal amount;
    private List<String> tags;
    private Owner owner;
    private Object memo;  // null，类型待确认
}
