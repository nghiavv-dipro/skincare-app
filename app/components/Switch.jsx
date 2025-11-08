import { useId } from "react";

export function Switch({ checked, onChange, disabled = false }) {
  const id = useId();

  return (
    <label
      htmlFor={id}
      style={{
        position: "relative",
        display: "inline-block",
        width: "44px",
        height: "24px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        style={{
          opacity: 0,
          width: 0,
          height: 0,
        }}
      />
      <span
        style={{
          position: "absolute",
          cursor: disabled ? "not-allowed" : "pointer",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: checked ? "#008060" : "#babfc3",
          transition: "0.3s",
          borderRadius: "24px",
        }}
      >
        <span
          style={{
            position: "absolute",
            content: '""',
            height: "18px",
            width: "18px",
            left: checked ? "23px" : "3px",
            bottom: "3px",
            backgroundColor: "white",
            transition: "0.3s",
            borderRadius: "50%",
          }}
        />
      </span>
    </label>
  );
}
